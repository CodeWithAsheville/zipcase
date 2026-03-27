import { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { handler } from '../disconnect';
import WebSocketStorage from '../../../lib/WebSocketStorage';

jest.mock('../../../lib/WebSocketStorage');

const mockStorage = WebSocketStorage as jest.Mocked<typeof WebSocketStorage>;

function makeEvent(connectionId = 'conn-1'): APIGatewayProxyWebsocketEventV2 {
    return {
        body: undefined,
        isBase64Encoded: false,
        requestContext: {
            routeKey: '$disconnect',
            messageId: 'message-id',
            eventType: 'DISCONNECT',
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
            connectionId,
            apiId: 'api-id',
        },
    } as unknown as APIGatewayProxyWebsocketEventV2;
}

describe('ws disconnect handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('always returns 200 and deletes connection', async () => {
        const response = await handler(makeEvent('conn-42'), {} as never, () => undefined);

        expect(mockStorage.deleteConnection).toHaveBeenCalledWith('conn-42');
        expect(response).toEqual({ statusCode: 200, body: 'Disconnected' });
    });

    it('still returns 200 when delete throws', async () => {
        mockStorage.deleteConnection.mockRejectedValue(new Error('ddb down'));

        const response = await handler(makeEvent('conn-42'), {} as never, () => undefined);

        expect(response).toEqual({ statusCode: 200, body: 'Disconnected' });
    });
});
