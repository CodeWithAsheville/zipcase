import { get, create } from '../apiKey';
import StorageClient from '../../../lib/StorageClient';

// Mock the dependencies
jest.mock('../../../lib/StorageClient');
jest.mock('@aws-sdk/client-api-gateway', () => {
    return {
        APIGatewayClient: jest.fn(() => ({
            send: jest.fn(),
        })),
        CreateApiKeyCommand: jest.fn(),
        CreateUsagePlanKeyCommand: jest.fn(),
        UpdateApiKeyCommand: jest.fn(),
    };
});

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
    });
});
