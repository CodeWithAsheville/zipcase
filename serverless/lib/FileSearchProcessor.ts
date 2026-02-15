import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
    TextractClient,
    DetectDocumentTextCommand,
    StartDocumentTextDetectionCommand,
    GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import pdf from 'pdf-parse';
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';
import { processCaseSearchRequest } from './CaseSearchProcessor';
import SearchParser from './SearchParser';
import { CaseSearchResponse } from '../../shared/types';
import { Readable } from 'stream';
import AlertService, { Severity, AlertCategory } from './AlertService';

const s3Client = new S3Client({});
const textractClient = new TextractClient({});

interface FileSearchRequest {
    fileKey: string;
    userId: string;
    userAgent?: string;
}

export async function processFileSearchRequest(req: FileSearchRequest): Promise<CaseSearchResponse> {
    const bucketName = process.env.UPLOADS_BUCKET;
    if (!bucketName) {
        throw new Error('UPLOADS_BUCKET environment variable is not set');
    }

    console.log(`Processing file search for user ${req.userId}, key: ${req.fileKey}`);

    // Extract extension from key
    const extension = req.fileKey.split('.').pop()?.toLowerCase() || '';

    // 1. Download file from S3
    const getObjectParams = {
        Bucket: bucketName,
        Key: req.fileKey,
    };

    const response = await s3Client.send(new GetObjectCommand(getObjectParams));

    if (!response.Body) {
        throw new Error('File body is empty');
    }

    const fileBuffer = await streamToBuffer(response.Body as Readable);
    const contentLength = response.ContentLength ?? fileBuffer.length;
    let extractedText = '';

    // 2. Process based on extension
    switch (extension) {
        case 'pdf':
            extractedText = await processPdf(fileBuffer, {
                bucketName,
                fileKey: req.fileKey,
                contentLength,
            });
            break;

        case 'xlsx':
        case 'xls':
        case 'csv': // xlsx library handles CSV well
            try {
                extractedText = processExcel(fileBuffer);
            } catch (error) {
                await AlertService.logError(Severity.WARNING, AlertCategory.SYSTEM, 'Excel processing failed', error as Error, {
                    fileKey: req.fileKey,
                });
                throw new Error('Failed to parse Excel/CSV file. The file might be corrupted or password protected.');
            }
            break;

        case 'docx':
            extractedText = await processDocx(fileBuffer);
            break;

        case 'jpg':
        case 'jpeg':
        case 'png':
            extractedText = await processTextractSync(fileBuffer);
            break;

        case 'txt':
            extractedText = fileBuffer.toString('utf-8');
            break;

        default:
            // Fallback: Try as text, then fail if nonsense? Or just error out.
            // But let's support "any common format" by assuming if it's text-like, we read it.
            // If unknown, we can try to read as string.
            console.warn(`Unknown extension ${extension}, attempting to read as text`);
            extractedText = fileBuffer.toString('utf-8');
    }

    console.log(`Extracted ${extractedText.length} characters from ${extension} file`);

    // 3. Process the extracted text using existing logic
    return processCaseSearchRequest({
        input: extractedText,
        userId: req.userId,
        userAgent: req.userAgent,
    });
}

const TEXTRACT_SYNC_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const TEXTRACT_SYNC_MAX_PAGES = 1;
const TEXTRACT_TEXT_THRESHOLD = 50;
const TEXTRACT_MAX_WAIT_MS = 45000;
const TEXTRACT_POLL_INTERVAL_MS = 1000;

async function processPdf(
    buffer: Buffer,
    options: {
        bucketName: string;
        fileKey: string;
        contentLength?: number;
    }
): Promise<string> {
    let extractedText = '';
    let useTextract = false;
    let pageCount = 0;

    try {
        const data = await pdf(buffer);
        extractedText = data.text;
        pageCount = data.numpages || 0;

        // Heuristic: If text is very short, it might be an image-only PDF
        if (extractedText.trim().length < TEXTRACT_TEXT_THRESHOLD) {
            console.log('PDF text too short, falling back to Textract');
            useTextract = true;
        } else if (!hasCaseNumbers(extractedText)) {
            console.log('PDF text did not include case numbers, falling back to Textract');
            useTextract = true;
        }
    } catch (error) {
        await AlertService.logError(Severity.WARNING, AlertCategory.SYSTEM, 'PDF Parse failed, falling back to Textract', error as Error);
        useTextract = true;
    }

    if (useTextract) {
        const shouldUseAsync = shouldUseTextractAsync(options.contentLength, pageCount);
        extractedText = shouldUseAsync
            ? await processTextractAsync(options.bucketName, options.fileKey)
            : await processTextractSync(buffer);
    }

    return extractedText;
}

function processExcel(buffer: Buffer): string {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let text = '';

    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        // Convert sheet to text (csv format is robust for text extraction)
        text += xlsx.utils.sheet_to_csv(sheet) + '\n';
    });

    return text;
}

async function processDocx(buffer: Buffer): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        if (result.messages && result.messages.length > 0) {
            await AlertService.logError(Severity.WARNING, AlertCategory.SYSTEM, 'Mammoth warnings during DOCX processing', undefined, {
                messages: result.messages,
            });
        }
        return result.value;
    } catch (error) {
        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Docx extraction failed', error as Error);
        throw new Error('Failed to parse DOCX file. The file might be corrupted.');
    }
}

function hasCaseNumbers(text: string): boolean {
    if (!text.trim()) {
        return false;
    }

    return SearchParser.parseSearchInput(text).length > 0;
}

function shouldUseTextractAsync(contentLength: number | undefined, pageCount: number): boolean {
    if (contentLength && contentLength > TEXTRACT_SYNC_MAX_BYTES) {
        return true;
    }

    if (pageCount > TEXTRACT_SYNC_MAX_PAGES) {
        return true;
    }

    return false;
}

async function processTextractSync(buffer: Buffer): Promise<string> {
    console.log('Starting Textract sync processing...');
    try {
        const textractParams = {
            Document: {
                Bytes: buffer,
            },
        };
        const command = new DetectDocumentTextCommand(textractParams);
        const data = await textractClient.send(command);

        return extractTextractLines(data.Blocks);
    } catch (error: any) {
        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Textract failed', error as Error);
        // Handle specific AWS Textract errors if needed
        if (error.name === 'UnsupportedDocumentException') {
            throw new Error('The document format is not supported by the OCR engine.');
        } else if (error.name === 'DocumentTooLargeException') {
            throw new Error('The document is too large for OCR processing.');
        }
        throw new Error('Failed to process document with OCR: ' + (error.message || 'Unknown error'));
    }
}

async function processTextractAsync(bucketName: string, fileKey: string): Promise<string> {
    console.log('Starting Textract async processing...');
    try {
        const startCommand = new StartDocumentTextDetectionCommand({
            DocumentLocation: {
                S3Object: {
                    Bucket: bucketName,
                    Name: fileKey,
                },
            },
        });

        const startResponse = await textractClient.send(startCommand);
        const jobId = startResponse.JobId;

        if (!jobId) {
            throw new Error('Textract did not return a job id');
        }

        const startTime = Date.now();
        let nextToken: string | undefined;
        let blocks: Array<{ BlockType?: string; Text?: string }> = [];

        while (true) {
            const response = await textractClient.send(
                new GetDocumentTextDetectionCommand({
                    JobId: jobId,
                    NextToken: nextToken,
                })
            );

            if (response.JobStatus === 'FAILED') {
                throw new Error('OCR processing failed');
            }

            if (response.JobStatus !== 'SUCCEEDED') {
                if (Date.now() - startTime > TEXTRACT_MAX_WAIT_MS) {
                    throw new Error('OCR processing timed out');
                }
                await delay(TEXTRACT_POLL_INTERVAL_MS);
                continue;
            }

            if (response.Blocks) {
                blocks = blocks.concat(response.Blocks as Array<{ BlockType?: string; Text?: string }>);
            }

            if (response.NextToken) {
                nextToken = response.NextToken;
                continue;
            }

            break;
        }

        return extractTextractLines(blocks);
    } catch (error: any) {
        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Textract failed', error as Error);
        if (error.name === 'UnsupportedDocumentException') {
            throw new Error('The document format is not supported by the OCR engine.');
        } else if (error.name === 'DocumentTooLargeException') {
            throw new Error('The document is too large for OCR processing.');
        }
        throw new Error('Failed to process document with OCR: ' + (error.message || 'Unknown error'));
    }
}

function extractTextractLines(blocks?: Array<{ BlockType?: string; Text?: string }>): string {
    if (!blocks) {
        return '';
    }

    return blocks
        .filter(block => block.BlockType === 'LINE' && block.Text)
        .map(block => block.Text)
        .join('\n');
}

async function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('error', err => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
