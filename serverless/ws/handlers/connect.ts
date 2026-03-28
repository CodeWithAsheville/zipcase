import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { getUserIdFromBearerToken } from '../../lib/WebSocketAuth';
import WebSocketStorage from '../../lib/WebSocketStorage';

const unauthorized = {
    statusCode: 401,
    body: 'Unauthorized',
};

export const handler: APIGatewayProxyWebsocketHandlerV2 = async event => {
    try {
        const connectionId = event.requestContext.connectionId;
        if (!connectionId) {
            return unauthorized;
        }

        const eventWithAuth = event as unknown as {
            headers?: Record<string, string | undefined>;
            queryStringParameters?: Record<string, string | undefined>;
        };

        const authHeader =
            eventWithAuth.headers?.Authorization ||
            eventWithAuth.headers?.authorization ||
            eventWithAuth.queryStringParameters?.authorization ||
            eventWithAuth.queryStringParameters?.token;

        const userId = await getUserIdFromBearerToken(authHeader);
        if (!userId) {
            return unauthorized;
        }

        await WebSocketStorage.saveConnection(connectionId, userId);

        return {
            statusCode: 200,
            body: 'Connected',
        };
    } catch (error) {
        console.error('WebSocket connect failed:', error);
        return unauthorized;
    }
};
