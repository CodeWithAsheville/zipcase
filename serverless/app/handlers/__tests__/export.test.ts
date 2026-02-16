import { handler } from '../export';
import { BatchHelper, Key } from '../../../lib/StorageClient';
import ExcelJS from 'exceljs';

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
const mockCells = new Map<string, { value?: unknown; font?: unknown }>();
const mockWorksheet = {
    columns: [] as unknown[],
    addRows: jest.fn(),
    getRow: jest.fn((rowNumber: number) => ({
        getCell: jest.fn((columnNumber: number) => {
            const key = `${rowNumber}:${columnNumber}`;
            if (!mockCells.has(key)) {
                mockCells.set(key, {});
            }
            return mockCells.get(key)!;
        }),
    })),
};
const writeBufferMock = jest.fn().mockResolvedValue(Buffer.from('mock-excel-content'));
const mockWorkbook = {
    addWorksheet: jest.fn().mockReturnValue(mockWorksheet),
    xlsx: {
        writeBuffer: writeBufferMock,
    },
};
jest.mock('exceljs', () => ({
    __esModule: true,
    default: {
        Workbook: jest.fn().mockImplementation(() => mockWorkbook),
    },
}));

describe('export handler', () => {
    const mockEvent = (body: any) =>
        ({
            body: JSON.stringify(body),
        }) as any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCells.clear();
        mockWorksheet.columns = [];
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
        expect(ExcelJS.Workbook).toHaveBeenCalledTimes(1);
        expect(writeBufferMock).toHaveBeenCalledTimes(1);

        // Verify worksheet rows
        expect(mockWorksheet.addRows).toHaveBeenCalledWith([
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

        expect(mockWorksheet.addRows).toHaveBeenCalledWith([
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

        expect(mockWorksheet.addRows).toHaveBeenCalledWith([
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

        const calls = (mockWorksheet.addRows as jest.Mock).mock.calls[0][0];
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

        expect(mockWorksheet.getRow).toHaveBeenCalledWith(2);
        const caseNumberCell = mockCells.get('2:1');
        expect(caseNumberCell?.value).toEqual({
            text: 'CASE123',
            hyperlink: 'https://portal.example.com/search-results/#/case-id-123',
        });
        expect(caseNumberCell?.font).toMatchObject({
            color: { argb: 'FF0563C1' },
            underline: true,
        });
    });

    it('should keep text value and hyperlink relationship for quoted case numbers', async () => {
        const mockCaseNumbers = ['CASE"123'];

        const mockSummary = { charges: [] };
        const mockZipCase = { caseId: 'case"id-123', fetchStatus: { status: 'complete' } };
        (BatchHelper.getMany as jest.Mock).mockImplementation(async (keys: any[]) => {
            const map = new Map();
            keys.forEach(key => {
                if (key.PK === 'CASE#CASE"123' && key.SK === 'SUMMARY') map.set(key, mockSummary);
                if (key.PK === 'CASE#CASE"123' && key.SK === 'ID') map.set(key, mockZipCase);
            });
            return map;
        });

        await handler(mockEvent({ caseNumbers: mockCaseNumbers }), {} as any, {} as any);

        const caseNumberCell = mockCells.get('2:1');
        expect(caseNumberCell?.value).toEqual({
            text: 'CASE"123',
            hyperlink: 'https://portal.example.com/search-results/#/case"id-123',
        });
    });
});
