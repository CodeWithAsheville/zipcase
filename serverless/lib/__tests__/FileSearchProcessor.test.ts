/**
 * Tests for FileSearchProcessor
 */
import { processFileSearchRequest } from '../FileSearchProcessor';
import { processCaseSearchRequest } from '../CaseSearchProcessor';
import SearchParser from '../SearchParser';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
    TextractClient,
    DetectDocumentTextCommand,
    StartDocumentTextDetectionCommand,
    GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import { Readable } from 'stream';

jest.mock('../CaseSearchProcessor');
jest.mock('../SearchParser');
jest.mock('pdf-parse');
jest.mock('mammoth');
jest.mock('xlsx');

jest.mock('@aws-sdk/client-s3', () => {
    const mockS3Send = jest.fn();
    (globalThis as { __mockS3Send?: jest.Mock }).__mockS3Send = mockS3Send;
    return {
        S3Client: jest.fn(() => ({ send: mockS3Send })),
        GetObjectCommand: jest.fn(),
    };
});

jest.mock('@aws-sdk/client-textract', () => {
    const mockTextractSend = jest.fn();
    (globalThis as { __mockTextractSend?: jest.Mock }).__mockTextractSend = mockTextractSend;
    return {
        TextractClient: jest.fn(() => ({ send: mockTextractSend })),
        DetectDocumentTextCommand: jest.fn(),
        StartDocumentTextDetectionCommand: jest.fn(),
        GetDocumentTextDetectionCommand: jest.fn(),
    };
});

const mockS3Send = (globalThis as { __mockS3Send?: jest.Mock }).__mockS3Send ?? jest.fn();
const mockTextractSend = (globalThis as { __mockTextractSend?: jest.Mock }).__mockTextractSend ?? jest.fn();

const mockProcessCaseSearchRequest = processCaseSearchRequest as jest.MockedFunction<typeof processCaseSearchRequest>;
const mockSearchParser = SearchParser as jest.Mocked<typeof SearchParser>;
const mockPdfParse = pdf as unknown as jest.MockedFunction<typeof pdf>;
const mockMammoth = mammoth as jest.Mocked<typeof mammoth>;
const mockXlsx = xlsx as jest.Mocked<typeof xlsx>;

function bufferToStream(buffer: Buffer) {
    return Readable.from(buffer);
}

describe('FileSearchProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.UPLOADS_BUCKET = 'test-bucket';
        mockProcessCaseSearchRequest.mockResolvedValue({ results: {} });
    });

    it('extracts text from txt and forwards to case search', async () => {
        const content = '22CR123456-789 23CV654321-456';
        const buffer = Buffer.from(content, 'utf-8');

        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });

        await processFileSearchRequest({ fileKey: 'uploads/user/sample.txt', userId: 'user1' });

        expect(GetObjectCommand).toHaveBeenCalledWith({
            Bucket: 'test-bucket',
            Key: 'uploads/user/sample.txt',
        });
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: content,
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('extracts text from docx and forwards to case search', async () => {
        const buffer = Buffer.from('docx-data');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockMammoth.extractRawText.mockResolvedValue({ value: 'docx text', messages: [] });

        await processFileSearchRequest({ fileKey: 'uploads/user/sample.docx', userId: 'user1' });

        expect(mockMammoth.extractRawText).toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'docx text',
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('extracts text from xlsx/csv and forwards to case search', async () => {
        const buffer = Buffer.from('xlsx');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockXlsx.read.mockReturnValue({
            SheetNames: ['Sheet1'],
            Sheets: { Sheet1: {} },
        } as any);
        jest.mocked(mockXlsx.utils.sheet_to_csv).mockReturnValue('sheet text');

        await processFileSearchRequest({ fileKey: 'uploads/user/sample.xlsx', userId: 'user1' });

        expect(mockXlsx.read).toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'sheet text\n',
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('uses pdf-parse when PDF has extractable text', async () => {
        const buffer = Buffer.from('pdf');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        const pdfText = 'This PDF contains case 22CR123456-789 with enough text to avoid OCR fallback.';
        mockPdfParse.mockResolvedValue({ text: pdfText, numpages: 1 } as any);
        mockSearchParser.parseSearchInput.mockReturnValue(['22CR123456-789']);

        await processFileSearchRequest({ fileKey: 'uploads/user/sample.pdf', userId: 'user1' });

        expect(mockPdfParse).toHaveBeenCalled();
        expect(DetectDocumentTextCommand).not.toHaveBeenCalled();
        expect(StartDocumentTextDetectionCommand).not.toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: pdfText,
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('falls back to Textract sync for small scanned PDFs', async () => {
        const buffer = Buffer.from('pdf');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockPdfParse.mockResolvedValue({ text: '  ', numpages: 1 } as any);
        mockSearchParser.parseSearchInput.mockReturnValue([]);
        mockTextractSend.mockResolvedValue({ Blocks: [{ BlockType: 'LINE', Text: 'ocr text' }] });

        await processFileSearchRequest({ fileKey: 'uploads/user/scan.pdf', userId: 'user1' });

        expect(DetectDocumentTextCommand).toHaveBeenCalled();
        expect(StartDocumentTextDetectionCommand).not.toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'ocr text',
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('uses Textract async for multi-page PDFs requiring OCR', async () => {
        const buffer = Buffer.from('pdf');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockPdfParse.mockResolvedValue({ text: '  ', numpages: 3 } as any);
        mockSearchParser.parseSearchInput.mockReturnValue([]);

        mockTextractSend
            .mockResolvedValueOnce({ JobId: 'job-123' })
            .mockResolvedValueOnce({ JobStatus: 'IN_PROGRESS' })
            .mockResolvedValueOnce({
                JobStatus: 'SUCCEEDED',
                Blocks: [{ BlockType: 'LINE', Text: 'ocr async' }],
            });

        await processFileSearchRequest({ fileKey: 'uploads/user/scan.pdf', userId: 'user1' });

        expect(StartDocumentTextDetectionCommand).toHaveBeenCalledWith({
            DocumentLocation: {
                S3Object: { Bucket: 'test-bucket', Name: 'uploads/user/scan.pdf' },
            },
        });
        expect(GetDocumentTextDetectionCommand).toHaveBeenCalledWith({ JobId: 'job-123', NextToken: undefined });
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'ocr async',
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('falls back to Textract when PDF has no case numbers', async () => {
        const buffer = Buffer.from('pdf');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockPdfParse.mockResolvedValue({ text: 'plain text', numpages: 1 } as any);
        mockSearchParser.parseSearchInput.mockReturnValue([]);
        mockTextractSend.mockResolvedValue({ Blocks: [{ BlockType: 'LINE', Text: 'ocr case 22CR123456-789' }] });

        await processFileSearchRequest({ fileKey: 'uploads/user/scan.pdf', userId: 'user1' });

        expect(DetectDocumentTextCommand).toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'ocr case 22CR123456-789',
            userId: 'user1',
            userAgent: undefined,
        });
    });

    it('uses Textract sync for image files', async () => {
        const buffer = Buffer.from('image');
        mockS3Send.mockResolvedValue({ Body: bufferToStream(buffer), ContentLength: buffer.length });
        mockTextractSend.mockResolvedValue({ Blocks: [{ BlockType: 'LINE', Text: 'image ocr' }] });

        await processFileSearchRequest({ fileKey: 'uploads/user/image.jpg', userId: 'user1' });

        expect(DetectDocumentTextCommand).toHaveBeenCalled();
        expect(mockProcessCaseSearchRequest).toHaveBeenCalledWith({
            input: 'image ocr',
            userId: 'user1',
            userAgent: undefined,
        });
    });
});
