const mockSend = jest.fn();
const mockDeleteConnection = jest.fn();
const mockGetConnectionIdsForSubject = jest.fn();

class MockGoneException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GoneException';
    }
}

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
    ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
        send: mockSend,
    })),
    PostToConnectionCommand: jest.fn().mockImplementation(input => input),
    GoneException: MockGoneException,
}));

jest.mock('../WebSocketStorage', () => ({
    __esModule: true,
    default: {
        getConnectionIdsForSubject: (...args: unknown[]) => mockGetConnectionIdsForSubject(...args),
        deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args),
    },
}));

describe('WebSocketPublisher', () => {
    const originalEndpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://example.execute-api.us-east-2.amazonaws.com/dev';
    });

    afterAll(() => {
        process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = originalEndpoint;
    });

    it('publishes case status updates to all subscribed connections', async () => {
        mockGetConnectionIdsForSubject.mockResolvedValue(['conn-a', 'conn-b']);
        mockSend.mockResolvedValue(undefined);

        const { default: WebSocketPublisher } = await import('../WebSocketPublisher');

        await WebSocketPublisher.publishCaseStatusUpdated('user-1', '22cr123', {
            zipCase: {
                caseNumber: '22CR123',
                fetchStatus: { status: 'found' },
            },
        });

        expect(mockGetConnectionIdsForSubject).toHaveBeenCalledWith('user-1', 'case', '22cr123');
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('deletes stale connections when GoneException is thrown', async () => {
        mockGetConnectionIdsForSubject.mockResolvedValue(['conn-stale']);
        mockSend.mockRejectedValue(new MockGoneException('gone'));

        const { default: WebSocketPublisher } = await import('../WebSocketPublisher');

        await WebSocketPublisher.publishCaseStatusUpdated('user-1', '22cr123', {
            zipCase: {
                caseNumber: '22CR123',
                fetchStatus: { status: 'complete' },
            },
        });

        expect(mockDeleteConnection).toHaveBeenCalledWith('conn-stale');
    });

    it('no-ops when management endpoint is missing', async () => {
        delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
        mockGetConnectionIdsForSubject.mockResolvedValue(['conn-a']);

        const { default: WebSocketPublisher } = await import('../WebSocketPublisher');

        await WebSocketPublisher.publishCaseStatusUpdated('user-1', '22cr123', {
            zipCase: {
                caseNumber: '22CR123',
                fetchStatus: { status: 'complete' },
            },
        });

        expect(mockGetConnectionIdsForSubject).not.toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
    });
});
