import { get, create } from '../apiKey';
import StorageClient from '../../../lib/StorageClient';
import {
    APIGatewayClient,
    CreateApiKeyCommand,
    CreateUsagePlanKeyCommand,
    UpdateApiKeyCommand,
} from '@aws-sdk/client-api-gateway';

// Mock the dependencies
jest.mock('../../../lib/StorageClient');
jest.mock('@aws-sdk/client-api-gateway');

// Mock the environment variables
process.env.DEFAULT_USAGE_PLAN_ID = 'test-usage-plan-id';

// Mock event with auth context
const createEvent = (body?: any, userId = 'test-user-id') => ({
    requestContext: {
        authorizer: {
            jwt: {
                claims: {
                    sub: userId,
                },
            },
        },
    },
    body: body ? JSON.stringify(body) : undefined,
});

describe('apiKey handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('get function', () => {
        it('should return 401 if user is not authenticated', async () => {
            const event = {
                requestContext: {
                    authorizer: {},
                },
            };

            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(401);
                expect(JSON.parse(response.body).error).toBe('Unauthorized');
            }
        });

        it('should return 204 if no API key is found for the user', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue(null);

            const event = createEvent();
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(204);
                expect(mockGetApiKey).toHaveBeenCalledWith('test-user-id');
            }
        });

        it('should return API key data if found', async () => {
            const apiKeyData = {
                apiKey: 'api-key-123',
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            };

            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue(apiKeyData);

            const event = createEvent();
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(200);
                expect(JSON.parse(response.body)).toEqual(apiKeyData);
                expect(mockGetApiKey).toHaveBeenCalledWith('test-user-id');
            }
        });

        it('should handle errors gracefully', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockRejectedValue(new Error('Database error'));

            const event = createEvent();
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(500);
                expect(JSON.parse(response.body).error).toBe('Internal server error');
                expect(JSON.parse(response.body).message).toBe('Database error');
            }
        });
    });

    describe('create function', () => {
        it('should return 401 if user is not authenticated', async () => {
            const event = {
                requestContext: {
                    authorizer: {},
                },
            };

            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(401);
                expect(JSON.parse(response.body).error).toBe('Unauthorized');
            }
        });

        it('should return 400 if webhook URL is invalid', async () => {
            const event = createEvent({
                webhookUrl: 'invalid-url',
            });

            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Invalid webhook URL format');
            }
        });

        it('should return 400 if webhook shared secret is too long', async () => {
            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                webhookSharedSecret: 'a'.repeat(129), // 129 characters, which exceeds the 128 character limit
            });

            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe(
                    'Webhook shared secret must not exceed 128 characters'
                );
            }
        });

        it.skip('should create a new API key successfully', async () => {
            // Mock the AWS API Gateway client responses
            const mockSend = jest.fn();
            (APIGatewayClient as jest.Mock).mockImplementation(() => ({
                send: mockSend,
            }));

            // Mock successful API key creation
            mockSend.mockImplementationOnce(() => ({
                id: 'new-api-key-id',
                value: 'new-api-key-value',
            }));

            // Mock successful usage plan association
            mockSend.mockImplementationOnce(() => ({}));

            // Mock StorageClient methods
            const mockGetApiKeyId = StorageClient.getApiKeyId as jest.Mock;
            mockGetApiKeyId.mockResolvedValue(null); // No existing API key

            const mockSaveApiKey = StorageClient.saveApiKey as jest.Mock;
            mockSaveApiKey.mockResolvedValue(undefined);

            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                webhookSharedSecret: 'valid-secret',
            });

            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(201); // Created
                expect(JSON.parse(response.body).apiKey).toBe('new-api-key-value');
            }

            // Verify API Gateway client calls
            expect(mockSend).toHaveBeenCalledWith(expect.any(CreateApiKeyCommand));
            expect(mockSend).toHaveBeenCalledWith(expect.any(CreateUsagePlanKeyCommand));

            // Verify StorageClient calls
            expect(mockSaveApiKey).toHaveBeenCalledWith(
                'test-user-id',
                'new-api-key-id',
                'new-api-key-value'
            );
        });

        it.skip('should disable the previous API key when creating a new one', async () => {
            // Mock the AWS API Gateway client responses
            const mockSend = jest.fn();
            (APIGatewayClient as jest.Mock).mockImplementation(() => ({
                send: mockSend,
            }));

            // Mock successful API key creation
            mockSend.mockImplementationOnce(() => ({
                id: 'new-api-key-id',
                value: 'new-api-key-value',
            }));

            // Mock successful usage plan association
            mockSend.mockImplementationOnce(() => ({}));

            // Mock successful API key update (disabling old key)
            mockSend.mockImplementationOnce(() => ({}));

            // Mock StorageClient methods
            const mockGetApiKeyId = StorageClient.getApiKeyId as jest.Mock;
            mockGetApiKeyId.mockResolvedValue('old-api-key-id'); // Existing API key

            const mockSaveApiKey = StorageClient.saveApiKey as jest.Mock;
            mockSaveApiKey.mockResolvedValue(undefined);

            const event = createEvent();

            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(200); // OK (not 201 Created since updating)
                expect(JSON.parse(response.body).apiKey).toBe('new-api-key-value');
            }

            // Verify API Gateway client calls for disabling old key
            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: {
                        apiKey: 'old-api-key-id',
                        patchOperations: [
                            {
                                op: 'replace',
                                path: '/enabled',
                                value: 'false',
                            },
                        ],
                    },
                })
            );
        });

        it.skip('should handle errors gracefully', async () => {
            // Mock the AWS API Gateway client to throw an error
            const mockSend = jest.fn();
            mockSend.mockRejectedValue(new Error('AWS API Gateway error'));

            (APIGatewayClient as jest.Mock).mockImplementation(() => ({
                send: mockSend,
            }));

            // Mock StorageClient method
            const mockGetApiKeyId = StorageClient.getApiKeyId as jest.Mock;
            mockGetApiKeyId.mockResolvedValue(null);

            const event = createEvent();
            const response = await create(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(500);
                expect(JSON.parse(response.body).error).toBe('Internal server error');
                expect(JSON.parse(response.body).message).toBe('AWS API Gateway error');
            }
        });
    });
});
