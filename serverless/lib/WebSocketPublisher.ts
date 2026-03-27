import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { SearchResult } from '../../shared/types';
import WebSocketStorage from './WebSocketStorage';

type CaseStatusEvent = {
    type: 'case.status.updated';
    subjectType: 'case';
    subjectId: string;
    timestamp: string;
    payload: SearchResult;
};

let managementClient: ApiGatewayManagementApiClient | null = null;

function getManagementClient(): ApiGatewayManagementApiClient | null {
    const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
    if (!endpoint) {
        return null;
    }

    if (!managementClient) {
        managementClient = new ApiGatewayManagementApiClient({ endpoint });
    }

    return managementClient;
}

async function postToConnection(connectionId: string, data: string): Promise<void> {
    const client = getManagementClient();
    if (!client) {
        return;
    }

    try {
        await client.send(
            new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: Buffer.from(data),
            })
        );
    } catch (error) {
        if (error instanceof GoneException) {
            await WebSocketStorage.deleteConnection(connectionId);
            return;
        }

        const errorName = error instanceof Error ? error.name : '';
        if (errorName === 'GoneException') {
            await WebSocketStorage.deleteConnection(connectionId);
            return;
        }

        throw error;
    }
}

const WebSocketPublisher = {
    async publishCaseStatusUpdated(userId: string, caseNumber: string, result: SearchResult): Promise<void> {
        const client = getManagementClient();
        if (!client) {
            return;
        }

        const event: CaseStatusEvent = {
            type: 'case.status.updated',
            subjectType: 'case',
            subjectId: caseNumber.toUpperCase(),
            timestamp: new Date().toISOString(),
            payload: result,
        };

        const connectionIds = await WebSocketStorage.getConnectionIdsForSubject(userId, 'case', caseNumber);
        if (connectionIds.length === 0) {
            return;
        }

        const serialized = JSON.stringify(event);
        await Promise.allSettled(connectionIds.map(connectionId => postToConnection(connectionId, serialized)));
    },
};

export default WebSocketPublisher;
