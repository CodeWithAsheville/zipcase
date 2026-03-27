import { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { handler } from '../unsubscribe';
import WebSocketStorage from '../../../lib/WebSocketStorage';

jest.mock('../../../lib/WebSocketStorage');

const mockStorage = WebSocketStorage as jest.Mocked<typeof WebSocketStorage>;

function makeEvent(body: unknown): APIGatewayProxyWebsocketEventV2 {
    return {
        body: JSON.stringify(body),
        isBase64Encoded: false,
        requestContext: {
            routeKey: 'unsubscribe',
            messageId: 'message-id',
            eventType: 'MESSAGE',
            extendedRequestId: 'request-id',
            requestTime: '01/Jan/2026:00:00:00 +0000',
            messageDirection: 'IN',
            stage: 'dev',
            connectedAt: Date.now(),
            requestTimeEpoch: Date.now(),
            identity: {
                sourceIp: '127.0.0.1',
            },
            requestId: 'request-id',
            domainName: 'ws.example.com',
            connectionId: 'conn-1',
            apiId: 'api-id',
        },
    } as APIGatewayProxyWebsocketEventV2;
}

describe('ws unsubscribe handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.getUserIdByConnection.mockResolvedValue('user-1');
        mockStorage.unsubscribe.mockResolvedValue(undefined);
    });

    it('unsubscribes deduped non-empty subjects', async () => {
        const response = (await handler(
            makeEvent({ subjectType: 'case', subjects: ['22CR1', '22CR1', '  ', '22CR2'] }),
            {} as never,
            () => undefined
        )) as any;

        expect(mockStorage.unsubscribe).toHaveBeenCalledTimes(2);
        expect(mockStorage.unsubscribe).toHaveBeenCalledWith('conn-1', 'user-1', 'case', '22CR1');
        expect(mockStorage.unsubscribe).toHaveBeenCalledWith('conn-1', 'user-1', 'case', '22CR2');
        expect(response.statusCode).toBe(200);
    });

    it('returns 401 when connection has no user', async () => {
        mockStorage.getUserIdByConnection.mockResolvedValue(null);

        const response = (await handler(makeEvent({ subjectType: 'case', subjects: ['22CR1'] }), {} as never, () => undefined)) as any;

        expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid body', async () => {
        const response = (await handler(makeEvent({ subjectType: 'case', subjects: [] }), {} as never, () => undefined)) as any;

        expect(response.statusCode).toBe(400);
    });

    it('returns 400 for unsupported subject type', async () => {
        const response = (await handler(makeEvent({ subjectType: 'name-search', subjects: ['abc'] }), {} as never, () => undefined)) as any;

        expect(response.statusCode).toBe(400);
    });
});
