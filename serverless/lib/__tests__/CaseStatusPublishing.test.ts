import { processCaseSearchRecord } from '../CaseSearchProcessor';
import PortalAuthenticator from '../PortalAuthenticator';
import StorageClient from '../StorageClient';
import UserAgentClient from '../UserAgentClient';
import WebSocketPublisher from '../WebSocketPublisher';
import AlertService from '../AlertService';
import PortalRequestClient from '../PortalRequestClient';

jest.mock('../PortalAuthenticator');
jest.mock('../QueueClient');
jest.mock('../StorageClient');
jest.mock('../UserAgentClient');
jest.mock('../WebSocketPublisher');
jest.mock('../AlertService');

jest.mock('axios-cookiejar-support', () => ({
    wrapper: jest.fn((client: unknown) => client),
}));

jest.mock('../PortalRequestClient', () => {
    return jest.fn().mockImplementation(() => ({
        get: jest.fn(),
    }));
});

const mockPortal = PortalAuthenticator as jest.Mocked<typeof PortalAuthenticator>;
const mockStorage = StorageClient as jest.Mocked<typeof StorageClient>;
const mockUserAgent = UserAgentClient as jest.Mocked<typeof UserAgentClient>;
const mockPublisher = WebSocketPublisher as jest.Mocked<typeof WebSocketPublisher>;
const mockAlertService = AlertService as jest.Mocked<typeof AlertService>;
const mockPortalRequestClient = PortalRequestClient as jest.MockedClass<typeof PortalRequestClient>;

describe('case status websocket publishing', () => {
    let CaseProcessor: any;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PORTAL_URL = 'https://portal.example.com';
        process.env.PORTAL_CASE_URL = 'https://portal.example.com/';
        mockPublisher.publishCaseStatusUpdated.mockResolvedValue(undefined);
        mockAlertService.logError.mockResolvedValue(undefined);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        ({ default: CaseProcessor } = jest.requireActual('../CaseProcessor'));
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('publishes failed status when case search auth fails', async () => {
        mockStorage.getCase.mockResolvedValue({
            caseNumber: '22CR123',
            fetchStatus: { status: 'queued' },
        } as never);

        mockPortal.getOrCreateUserSession.mockResolvedValue({
            success: false,
            message: 'Invalid Email or password',
        } as never);

        await processCaseSearchRecord('22CR123', 'user-1', 'receipt-1', {
            error: jest.fn().mockResolvedValue(undefined),
            critical: jest.fn().mockResolvedValue(undefined),
        } as never);

        expect(mockPublisher.publishCaseStatusUpdated).toHaveBeenCalledWith(
            'user-1',
            '22CR123',
            expect.objectContaining({
                zipCase: expect.objectContaining({
                    caseNumber: '22CR123',
                    fetchStatus: expect.objectContaining({ status: 'processing' }),
                }),
            })
        );

        expect(mockPublisher.publishCaseStatusUpdated).toHaveBeenCalledWith(
            'user-1',
            '22CR123',
            expect.objectContaining({
                zipCase: expect.objectContaining({
                    caseNumber: '22CR123',
                    fetchStatus: expect.objectContaining({ status: 'failed' }),
                }),
            })
        );
    });

    it('publishes complete status when case data processing completes', async () => {
        mockStorage.getCase.mockResolvedValue(null as never);
        mockStorage.saveCaseSummary.mockResolvedValue(undefined as never);
        mockUserAgent.getUserAgent.mockResolvedValue('test-agent');
        mockPortal.getOrCreateUserSession.mockResolvedValue({
            success: true,
            cookieJar: {} as never,
        } as never);

        const client = { get: jest.fn() };
        mockPortalRequestClient.mockImplementation(() => client as never);

        client.get.mockImplementation((url: string) => {
            if (url.includes('CaseSummariesSlim')) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        CaseSummaryHeader: {
                            Style: 'State v Test',
                            Heading: 'Court',
                            CaseId: 'case-id-1',
                        },
                    },
                });
            }

            if (url.includes("Charges('")) {
                return Promise.resolve({ status: 200, data: { Charges: [] } });
            }

            if (url.includes("DispositionEvents('")) {
                return Promise.resolve({ status: 200, data: { Events: [] } });
            }

            if (url.includes("FinancialSummary('")) {
                return Promise.resolve({ status: 200, data: {} });
            }

            if (url.includes("CaseEvents('")) {
                return Promise.resolve({ status: 200, data: { Events: [] } });
            }

            return Promise.resolve({ status: 200, data: {} });
        });

        await (CaseProcessor as any).processCaseData({
            Records: [
                {
                    body: JSON.stringify({ caseNumber: '22CR123', caseId: 'case-id-1', userId: 'user-1' }),
                    receiptHandle: 'receipt-2',
                    messageId: 'msg-1',
                },
            ],
        });

        expect(mockPublisher.publishCaseStatusUpdated).toHaveBeenCalledWith(
            'user-1',
            '22CR123',
            expect.objectContaining({
                zipCase: expect.objectContaining({
                    caseNumber: '22CR123',
                    caseId: 'case-id-1',
                    fetchStatus: { status: 'complete' },
                }),
            })
        );
    });

    it('publishes failed status when case data processing throws', async () => {
        mockStorage.getCase.mockResolvedValue(null as never);
        mockUserAgent.getUserAgent.mockResolvedValue('test-agent');
        mockPortal.getOrCreateUserSession.mockResolvedValue({
            success: true,
            cookieJar: {} as never,
        } as never);

        const client = { get: jest.fn() };
        mockPortalRequestClient.mockImplementation(() => client as never);

        client.get.mockRejectedValue(new Error('portal timeout'));

        await (CaseProcessor as any).processCaseData({
            Records: [
                {
                    body: JSON.stringify({ caseNumber: '22CR500', caseId: 'case-id-500', userId: 'user-1' }),
                    receiptHandle: 'receipt-500',
                    messageId: 'msg-500',
                },
            ],
        });

        expect(mockPublisher.publishCaseStatusUpdated).toHaveBeenCalledWith(
            'user-1',
            '22CR500',
            expect.objectContaining({
                zipCase: expect.objectContaining({
                    caseNumber: '22CR500',
                    caseId: 'case-id-500',
                    fetchStatus: expect.objectContaining({ status: 'failed' }),
                }),
            })
        );

        expect(mockPublisher.publishCaseStatusUpdated).not.toHaveBeenCalledWith(
            'user-1',
            '22CR500',
            expect.objectContaining({
                zipCase: expect.objectContaining({
                    fetchStatus: { status: 'processing' },
                }),
            })
        );
    });
});
