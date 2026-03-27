import { processCaseSearchRecord } from '../CaseSearchProcessor';
import PortalAuthenticator from '../PortalAuthenticator';
import QueueClient from '../QueueClient';
import StorageClient from '../StorageClient';
import UserAgentClient from '../UserAgentClient';
import WebSocketPublisher from '../WebSocketPublisher';

jest.mock('../PortalAuthenticator');
jest.mock('../QueueClient');
jest.mock('../StorageClient');
jest.mock('../UserAgentClient');
jest.mock('../WebSocketPublisher');

jest.mock('axios', () => {
    const get = jest.fn();
    return {
        __esModule: true,
        default: {
            request: jest.fn(),
            create: jest.fn(() => ({ get })),
        },
        request: jest.fn(),
        create: jest.fn(() => ({ get })),
    };
});

jest.mock('axios-cookiejar-support', () => ({
    wrapper: jest.fn((client: unknown) => client),
}));

const mockPortal = PortalAuthenticator as jest.Mocked<typeof PortalAuthenticator>;
const mockQueue = QueueClient as jest.Mocked<typeof QueueClient>;
const mockStorage = StorageClient as jest.Mocked<typeof StorageClient>;
const mockUserAgent = UserAgentClient as jest.Mocked<typeof UserAgentClient>;
const mockPublisher = WebSocketPublisher as jest.Mocked<typeof WebSocketPublisher>;

describe('case status websocket publishing', () => {
    let CaseProcessor: any;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PORTAL_URL = 'https://portal.example.com';
        process.env.PORTAL_CASE_URL = 'https://portal.example.com/';
        mockPublisher.publishCaseStatusUpdated.mockResolvedValue(undefined);
        CaseProcessor = require('../CaseProcessor').default;
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
                    fetchStatus: expect.objectContaining({ status: 'failed' }),
                }),
            })
        );
    });

    it('publishes complete status when case data processing completes', async () => {
        mockStorage.getCase.mockResolvedValue(null as never);
        mockStorage.saveCaseSummary.mockResolvedValue(undefined as never);
        mockUserAgent.getUserAgent.mockResolvedValue('test-agent');

        const axios = await import('axios');
        const client = (axios.default.create as jest.Mock).mock.results[0]?.value || (axios.default.create as jest.Mock)();

        (client.get as jest.Mock).mockImplementation((url: string) => {
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
});
