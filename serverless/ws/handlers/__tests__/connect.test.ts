import { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { handler } from '../connect';
import { getUserIdFromBearerToken } from '../../../lib/WebSocketAuth';
import WebSocketStorage from '../../../lib/WebSocketStorage';

jest.mock('../../../lib/WebSocketAuth');
jest.mock('../../../lib/WebSocketStorage');

const mockAuth = getUserIdFromBearerToken as jest.MockedFunction<typeof getUserIdFromBearerToken>;
const mockStorage = WebSocketStorage as jest.Mocked<typeof WebSocketStorage>;

function makeEvent(overrides: Partial<APIGatewayProxyWebsocketEventV2> = {}): APIGatewayProxyWebsocketEventV2 {
    return {
        body: undefined,
        headers: {},
        isBase64Encoded: false,
        requestContext: {
            routeKey: '$connect',
            messageId: 'message-id',
            eventType: 'CONNECT',
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
        ...overrides,
    } as unknown as APIGatewayProxyWebsocketEventV2;
}

describe('ws connect handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 200 and saves connection when token resolves to user', async () => {
        mockAuth.mockResolvedValue('user-123');

        const event = makeEvent();
        (event as any).headers = { authorization: 'Bearer token' };
        const response = (await handler(event, {} as never, () => undefined)) as any;

        expect(mockAuth).toHaveBeenCalledWith('Bearer token');
        expect(mockStorage.saveConnection).toHaveBeenCalledWith('conn-1', 'user-123');
        expect(response).toEqual({ statusCode: 200, body: 'Connected' });
    });

    it('uses query token when header is absent', async () => {
        mockAuth.mockResolvedValue('user-123');

        const event = makeEvent();
        (event as any).queryStringParameters = { token: 'Bearer q-token' };
        await handler(event, {} as never, () => undefined);

        expect(mockAuth).toHaveBeenCalledWith('Bearer q-token');
    });

    it('returns 401 when auth resolves null', async () => {
        mockAuth.mockResolvedValue(null);

        const response = (await handler(makeEvent(), {} as never, () => undefined)) as any;

        expect(mockStorage.saveConnection).not.toHaveBeenCalled();
        expect(response).toEqual({ statusCode: 401, body: 'Unauthorized' });
    });

    it('returns 401 when auth throws', async () => {
        mockAuth.mockRejectedValue(new Error('bad token'));

        const response = (await handler(makeEvent(), {} as never, () => undefined)) as any;

        expect(response).toEqual({ statusCode: 401, body: 'Unauthorized' });
    });
});
