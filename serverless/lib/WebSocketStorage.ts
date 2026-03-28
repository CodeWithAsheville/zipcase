import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.ZIPCASE_DATA_TABLE || 'zipcase-data-dev';
const CONNECTION_TTL_SECONDS = Number(process.env.WEBSOCKET_CONNECTION_TTL_SECONDS || 86400);

const connectionPk = (connectionId: string) => `WSCONN#${connectionId}`;
const userConnectionsPk = (userId: string) => `WSUSER#${userId}`;
const subscriptionPk = (userId: string, subjectType: string, subjectId: string) => `WSSUB#${userId}#${subjectType}#${subjectId}`;
const connectionMetaSk = 'META';
const userConnectionSk = (connectionId: string) => `CONN#${connectionId}`;
const connectionSubscriptionSk = (subjectType: string, subjectId: string) => `SUB#${subjectType}#${subjectId}`;

interface ConnectionMeta {
    PK: string;
    SK: string;
    userId: string;
}

interface ConnectionSubscription {
    PK: string;
    SK: string;
    subjectType: string;
    subjectId: string;
}

const nowTtl = () => Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;

const WebSocketStorage = {
    async saveConnection(connectionId: string, userId: string): Promise<void> {
        const ttl = nowTtl();

        await Promise.all([
            dynamoDb.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: connectionPk(connectionId),
                        SK: connectionMetaSk,
                        userId,
                        expiresAt: ttl,
                    },
                })
            ),
            dynamoDb.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: userConnectionsPk(userId),
                        SK: userConnectionSk(connectionId),
                        connectionId,
                        expiresAt: ttl,
                    },
                })
            ),
        ]);
    },

    async deleteConnection(connectionId: string): Promise<void> {
        const meta = await dynamoDb.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: {
                    PK: connectionPk(connectionId),
                    SK: connectionMetaSk,
                },
            })
        );

        const connectionMeta = meta.Item as ConnectionMeta | undefined;
        if (!connectionMeta?.userId) {
            return;
        }

        const subscriptions = await dynamoDb.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
                ExpressionAttributeValues: {
                    ':pk': connectionPk(connectionId),
                    ':skPrefix': 'SUB#',
                },
            })
        );

        const deletes = [
            dynamoDb.send(
                new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: {
                        PK: connectionPk(connectionId),
                        SK: connectionMetaSk,
                    },
                })
            ),
            dynamoDb.send(
                new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: {
                        PK: userConnectionsPk(connectionMeta.userId),
                        SK: userConnectionSk(connectionId),
                    },
                })
            ),
        ];

        for (const item of subscriptions.Items || []) {
            const subscription = item as ConnectionSubscription;
            deletes.push(
                dynamoDb.send(
                    new DeleteCommand({
                        TableName: TABLE_NAME,
                        Key: {
                            PK: connectionPk(connectionId),
                            SK: subscription.SK,
                        },
                    })
                )
            );

            deletes.push(
                dynamoDb.send(
                    new DeleteCommand({
                        TableName: TABLE_NAME,
                        Key: {
                            PK: subscriptionPk(connectionMeta.userId, subscription.subjectType, subscription.subjectId),
                            SK: userConnectionSk(connectionId),
                        },
                    })
                )
            );
        }

        await Promise.all(deletes);
    },

    async getUserIdByConnection(connectionId: string): Promise<string | null> {
        const meta = await dynamoDb.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: {
                    PK: connectionPk(connectionId),
                    SK: connectionMetaSk,
                },
            })
        );

        const item = meta.Item as ConnectionMeta | undefined;
        return item?.userId || null;
    },

    async subscribe(connectionId: string, userId: string, subjectType: string, subjectId: string): Promise<void> {
        const normalizedSubjectId = subjectId.toUpperCase();
        const ttl = nowTtl();

        await Promise.all([
            dynamoDb.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: subscriptionPk(userId, subjectType, normalizedSubjectId),
                        SK: userConnectionSk(connectionId),
                        connectionId,
                        expiresAt: ttl,
                    },
                })
            ),
            dynamoDb.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: connectionPk(connectionId),
                        SK: connectionSubscriptionSk(subjectType, normalizedSubjectId),
                        subjectType,
                        subjectId: normalizedSubjectId,
                        expiresAt: ttl,
                    },
                })
            ),
        ]);
    },

    async unsubscribe(connectionId: string, userId: string, subjectType: string, subjectId: string): Promise<void> {
        const normalizedSubjectId = subjectId.toUpperCase();

        await Promise.all([
            dynamoDb.send(
                new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: {
                        PK: subscriptionPk(userId, subjectType, normalizedSubjectId),
                        SK: userConnectionSk(connectionId),
                    },
                })
            ),
            dynamoDb.send(
                new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: {
                        PK: connectionPk(connectionId),
                        SK: connectionSubscriptionSk(subjectType, normalizedSubjectId),
                    },
                })
            ),
        ]);
    },

    async getConnectionIdsForSubject(userId: string, subjectType: string, subjectId: string): Promise<string[]> {
        const normalizedSubjectId = subjectId.toUpperCase();
        const result = await dynamoDb.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
                ExpressionAttributeValues: {
                    ':pk': subscriptionPk(userId, subjectType, normalizedSubjectId),
                    ':skPrefix': 'CONN#',
                },
            })
        );

        return (result.Items || []).map(item => item.connectionId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    },
};

export default WebSocketStorage;
