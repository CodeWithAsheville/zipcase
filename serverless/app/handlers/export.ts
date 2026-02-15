import { APIGatewayProxyHandler } from 'aws-lambda';
import * as XLSX from 'xlsx';
import { BatchHelper, Key } from '../../lib/StorageClient';
import { CaseSummary, Disposition, ZipCase } from '../../../shared/types';

interface ExportRequest {
    caseNumbers: string[];
}

interface ExportRow {
    'Case Number': string;
    'Court Name': string;
    'Arrest Date': string;
    'Offense Description': string;
    'Offense Level': string;
    'Offense Date': string;
    Disposition: string;
    'Disposition Date': string;
    'Arresting Agency': string;
    Notes: string;
}

export const handler: APIGatewayProxyHandler = async event => {
    try {
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Missing request body' }),
            };
        }

        const { caseNumbers } = JSON.parse(event.body) as ExportRequest;

        if (!caseNumbers || !Array.isArray(caseNumbers) || caseNumbers.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Invalid or empty caseNumbers array' }),
            };
        }

        // Construct keys for batch get
        const summaryKeys = caseNumbers.map(cn => Key.Case(cn).SUMMARY);
        const idKeys = caseNumbers.map(cn => Key.Case(cn).ID);
        const allKeys = [...summaryKeys, ...idKeys];

        // Fetch case summaries and zip cases
        const dataMap = await BatchHelper.getMany<CaseSummary | ZipCase>(allKeys);

        const rows: ExportRow[] = [];
        const caseNumberToUrlMap = new Map<string, string>();

        for (const caseNumber of caseNumbers) {
            const summaryKey = Key.Case(caseNumber).SUMMARY;
            const idKey = Key.Case(caseNumber).ID;

            // Find keys in the original list to ensure object reference match for map lookup
            const originalSummaryKey = allKeys.find(k => k.PK === summaryKey.PK && k.SK === summaryKey.SK);
            const originalIdKey = allKeys.find(k => k.PK === idKey.PK && k.SK === idKey.SK);

            const summary = originalSummaryKey ? (dataMap.get(originalSummaryKey) as CaseSummary) : undefined;
            const zipCase = originalIdKey ? (dataMap.get(originalIdKey) as ZipCase) : undefined;

            // Filter out notFound cases
            if (!zipCase || zipCase.fetchStatus.status === 'notFound') {
                continue;
            }

            const caseUrl = zipCase.caseId && process.env.PORTAL_CASE_URL ? `${process.env.PORTAL_CASE_URL}/#/${zipCase.caseId}` : '';
            if (caseUrl) {
                caseNumberToUrlMap.set(caseNumber, caseUrl);
            }

            // Handle failed cases and those without summaries
            if (!summary || zipCase.fetchStatus.status === 'failed') {
                rows.push({
                    'Case Number': caseNumber,
                    'Court Name': '',
                    'Arrest Date': '',
                    'Offense Description': '',
                    'Offense Level': '',
                    'Offense Date': '',
                    'Disposition': '',
                    'Disposition Date': '',
                    'Arresting Agency': '',
                    Notes: 'Failed to load case data',
                });
                continue;
            }

            if (!summary.charges || summary.charges.length === 0) {
                rows.push({
                    'Case Number': caseNumber,
                    'Court Name': summary.court || '',
                    'Arrest Date': summary.arrestOrCitationDate || '',
                    'Offense Description': '',
                    'Offense Level': '',
                    'Offense Date': '',
                    'Disposition': '',
                    'Disposition Date': '',
                    'Arresting Agency': summary.filingAgency || '',
                    Notes: 'No charges found',
                });
                continue;
            }

            for (const charge of summary.charges) {
                // Find the most relevant disposition (e.g., the latest one)
                let disposition: Disposition | undefined;
                if (charge.dispositions && charge.dispositions.length > 0) {
                    // Sort by date descending
                    const sortedDispositions = [...charge.dispositions].sort((a, b) => {
                        return new Date(b.date).getTime() - new Date(a.date).getTime();
                    });
                    disposition = sortedDispositions[0];
                }

                rows.push({
                    'Case Number': caseNumber,
                    'Court Name': summary.court || '',
                    'Arrest Date': summary.arrestOrCitationDate || '',
                    'Offense Description': charge.description || '',
                    'Offense Level': charge.degree?.code || '',
                    'Offense Date': charge.offenseDate || '',
                    'Disposition': disposition ? disposition.description : '',
                    'Disposition Date': disposition ? disposition.date : '',
                    'Arresting Agency': charge.filingAgency || summary.filingAgency || '',
                    Notes: '',
                });
            }
        }

        // Create workbook and worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        const worksheetRange = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
        if (worksheetRange) {
            let caseNumberColumn = -1;
            for (let col = worksheetRange.s.c; col <= worksheetRange.e.c; col++) {
                const headerCell = ws[XLSX.utils.encode_cell({ r: 0, c: col })];
                if (headerCell?.v === 'Case Number') {
                    caseNumberColumn = col;
                    break;
                }
            }

            if (caseNumberColumn >= 0) {
                for (let row = 1; row <= worksheetRange.e.r; row++) {
                    const cellRef = XLSX.utils.encode_cell({ r: row, c: caseNumberColumn });
                    const cell = ws[cellRef];
                    const caseNumber = cell?.v ? String(cell.v) : '';
                    const caseUrl = caseNumberToUrlMap.get(caseNumber);
                    if (caseUrl && cell) {
                        const caseNumberCell = cell as XLSX.CellObject;
                        const escapedCaseUrl = caseUrl.replace(/"/g, '""');
                        const escapedCaseNumber = caseNumber.replace(/"/g, '""');
                        caseNumberCell.l = { Target: caseUrl };
                        caseNumberCell.f = `HYPERLINK("${escapedCaseUrl}","${escapedCaseNumber}")`;
                        caseNumberCell.t = 's';
                        caseNumberCell.v = caseNumber;
                        const existingStyle = (caseNumberCell.s as Record<string, unknown> | undefined) || {};
                        const existingFont = (existingStyle.font as Record<string, unknown> | undefined) || {};
                        caseNumberCell.s = {
                            ...existingStyle,
                            font: {
                                ...existingFont,
                                color: { rgb: '0563C1' },
                                underline: true,
                            },
                        };
                    }
                }
            }
        }

        // Auto-fit columns
        if (rows.length > 0) {
            const headers = Object.keys(rows[0]);
            const colWidths = headers.map(key => {
                let maxLength = key.length;
                rows.forEach(row => {
                    const val = row[key as keyof ExportRow];
                    const len = val ? String(val).length : 0;
                    if (len > maxLength) maxLength = len;
                });
                // Cap the width at 50 to prevent massive columns, but ensure at least 10
                return { wch: Math.min(Math.max(maxLength + 2, 10), 50) };
            });
            ws['!cols'] = colWidths;
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Cases');

        // Generate buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
        const filename = `ZipCase-Export-${timestamp}.xlsx`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (error) {
        console.error('Error exporting cases:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};
