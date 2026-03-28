import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import WebSocketStorage from '../../lib/WebSocketStorage';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async event => {
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
        return {
            statusCode: 200,
            body: 'Disconnected',
        };
    }

    try {
        await WebSocketStorage.deleteConnection(connectionId);
    } catch (error) {
        console.error('WebSocket disconnect cleanup failed:', error);
    }

    return {
        statusCode: 200,
        body: 'Disconnected',
    };
};
