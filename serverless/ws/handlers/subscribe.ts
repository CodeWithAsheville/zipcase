import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import WebSocketStorage from '../../lib/WebSocketStorage';

type SubjectType = 'case';

interface SubscribePayload {
    subjectType?: SubjectType;
    subjects?: string[];
}

const badRequest = (message: string) => ({
    statusCode: 400,
    body: JSON.stringify({ error: message }),
});

export const handler: APIGatewayProxyWebsocketHandlerV2 = async event => {
    try {
        const connectionId = event.requestContext.connectionId;
        if (!connectionId) {
            return badRequest('Missing connection id');
        }

        const body = JSON.parse(event.body || '{}') as SubscribePayload;
        if (!body.subjectType || !Array.isArray(body.subjects) || body.subjects.length === 0) {
            return badRequest('subjectType and non-empty subjects[] are required');
        }

        if (body.subjectType !== 'case') {
            return badRequest('Unsupported subjectType');
        }

        const userId = await WebSocketStorage.getUserIdByConnection(connectionId);
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' }),
            };
        }

        const subjects = Array.from(new Set(body.subjects.map(s => s.trim()).filter(Boolean)));
        await Promise.all(subjects.map(subjectId => WebSocketStorage.subscribe(connectionId, userId, body.subjectType!, subjectId)));

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, subjectType: body.subjectType, subjects }),
        };
    } catch (error) {
        console.error('WebSocket subscribe failed:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    }
};
