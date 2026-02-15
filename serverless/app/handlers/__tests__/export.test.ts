import { handler } from '../export';
import { BatchHelper, Key } from '../../../lib/StorageClient';
import * as XLSX from 'xlsx';

// Mock dependencies
jest.mock('../../../lib/StorageClient', () => ({
    BatchHelper: {
        getMany: jest.fn(),
    },
    Key: {
        Case: (caseNumber: string) => ({
            SUMMARY: { PK: `CASE#${caseNumber}`, SK: 'SUMMARY' },
            ID: { PK: `CASE#${caseNumber}`, SK: 'ID' },
        }),
    },
}));
jest.mock('xlsx', () => ({
    utils: {
        book_new: jest.fn(),
        json_to_sheet: jest.fn().mockReturnValue({}),
        book_append_sheet: jest.fn(),
        decode_range: jest.fn().mockImplementation((range: string) => {
            const [, end] = range.split(':');
            const col = end.replace(/\d/g, '');
            const row = Number(end.replace(/[A-Z]/g, ''));
            const colIndex = col.split('').reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
            return {
                s: { c: 0, r: 0 },
                e: { c: colIndex, r: row - 1 },
            };
        }),
        encode_cell: jest.fn().mockImplementation(({ r, c }: { r: number; c: number }) => {
            let col = '';
            let current = c + 1;
            while (current > 0) {
                const rem = (current - 1) % 26;
                col = String.fromCharCode(65 + rem) + col;
                current = Math.floor((current - 1) / 26);
            }
            return `${col}${r + 1}`;
        }),
    },
    write: jest.fn().mockReturnValue(Buffer.from('mock-excel-content')),
}));

describe('export handler', () => {
    const mockEvent = (body: any) =>
        ({
            body: JSON.stringify(body),
        }) as any;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PORTAL_CASE_URL = 'https://portal.example.com/search-results';
    });

    it('should return 400 if body is missing', async () => {
        const result = await handler({} as any, {} as any, {} as any);
        expect(result).toEqual({
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing request body' }),
        });
    });

    it('should return 400 if caseNumbers is invalid', async () => {
        const result = await handler(mockEvent({ caseNumbers: [] }), {} as any, {} as any);
        expect(result).toEqual({
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid or empty caseNumbers array' }),
        });
    });

    it('should generate excel file with correct data', async () => {
        const mockCaseNumbers = ['CASE123'];

        // Mock data
        const mockSummary = {
            court: 'Test Court',
            arrestOrCitationDate: '2023-01-01',
            filingAgency: 'Test Agency',
            charges: [
                {
                    description: 'Test Charge',
                    degree: { code: 'F1', description: 'Felony 1' },
                    offenseDate: '2023-01-01',
                    dispositions: [{ description: 'Guilty', date: '2023-02-01' }],
                },
            ],
        };

        const mockZipCase = {
            caseId: 'case-id-123',
            fetchStatus: { status: 'complete' },
        };

        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE123' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE123' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        const result = await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        expect(result).toMatchObject({
            statusCode: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
            isBase64Encoded: true,
        });

        // Verify XLSX calls
        expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([
            {
                'Case Number': 'CASE123',
                'Court Name': 'Test Court',
                'Arrest Date': '2023-01-01',
                'Offense Description': 'Test Charge',
                'Offense Level': 'F1', // Raw code
                'Offense Date': '2023-01-01',
                Disposition: 'Guilty',
                'Disposition Date': '2023-02-01',
                'Arresting Agency': 'Test Agency',
                Notes: '',
            },
        ]);
    });

    it('should handle failed cases', async () => {
        const mockCaseNumbers = ['CASE_FAILED'];

        const mockZipCase = {
            fetchStatus: { status: 'failed' },
        };

        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE_FAILED' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([
            expect.objectContaining({
                'Case Number': 'CASE_FAILED',
                Notes: 'Failed to load case data',
            }),
        ]);
    });

    it('should handle cases with no charges', async () => {
        const mockCaseNumbers = ['CASE_NO_CHARGES'];

        const mockSummary = {
            court: 'Test Court',
            charges: [],
        };

        const mockZipCase = {
            fetchStatus: { status: 'complete' },
        };

        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE_NO_CHARGES' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE_NO_CHARGES' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([
            expect.objectContaining({
                'Case Number': 'CASE_NO_CHARGES',
                Notes: 'No charges found',
            }),
        ]);
    });

    it('should use raw offense level codes', async () => {
        const mockCaseNumbers = ['CASE_LEVELS'];

        const mockSummary = {
            charges: [
                { degree: { code: 'M1' }, dispositions: [] },
                { degree: { description: 'Felony Class A' }, dispositions: [] }, // No code
                { degree: { code: 'GL M' }, dispositions: [] },
                { degree: { code: 'T' }, dispositions: [] },
                { degree: { code: 'INF' }, dispositions: [] },
            ],
        };

        const mockZipCase = {
            fetchStatus: { status: 'complete' },
        };

        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE_LEVELS' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE_LEVELS' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        const calls = (XLSX.utils.json_to_sheet as jest.Mock).mock.calls[0][0];
        const levels = calls.map((row: any) => row['Offense Level']);

        expect(levels).toEqual(['M1', '', 'GL M', 'T', 'INF']);
    });

    it('should use correct filename format', async () => {
        const mockCaseNumbers = ['CASE123'];
        const mockSummary = { charges: [] };
        const mockZipCase = { fetchStatus: { status: 'complete' } };

        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE123' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE123' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        const result = await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        expect(result).toMatchObject({
            statusCode: 200,
            headers: {
                'Content-Disposition': expect.stringMatching(/attachment; filename="ZipCase-Export-\d{8}-\d{6}\.xlsx"/),
            },
        });
    });

    it('should create clickable hyperlink for case number cells', async () => {
        const mockCaseNumbers = ['CASE123'];
        const worksheet = {
            '!ref': 'A1:J2',
            A1: { v: 'Case Number' },
            B1: { v: 'Court Name' },
            C1: { v: 'Arrest Date' },
            D1: { v: 'Offense Description' },
            E1: { v: 'Offense Level' },
            F1: { v: 'Offense Date' },
            G1: { v: 'Disposition' },
            H1: { v: 'Disposition Date' },
            I1: { v: 'Arresting Agency' },
            J1: { v: 'Notes' },
            A2: { v: 'CASE123' },
        };
        (XLSX.utils.json_to_sheet as jest.Mock).mockReturnValueOnce(worksheet);

        const mockSummary = { charges: [] };
        const mockZipCase = { caseId: 'case-id-123', fetchStatus: { status: 'complete' } };
        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE123' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE123' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        expect(worksheet.A2).toMatchObject({
            l: { Target: 'https://portal.example.com/search-results/#/case-id-123' },
        });
    });
});
