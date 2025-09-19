import { setWebhook } from '../webhook';
import StorageClient from '../../../lib/StorageClient';

// Mock the dependencies
jest.mock('../../../lib/StorageClient');

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

describe('webhook handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('setWebhook function', () => {
        it('should return 401 if user is not authenticated', async () => {
            const event = {
                requestContext: {
                    authorizer: {},
                },
            };

            const response = await setWebhook(event as any, null as any, null as any);

            // Need to assert response is not void
            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(401);
                expect(JSON.parse(response.body).error).toBe('Unauthorized');
            }
        });

        it('should return 400 if request body is missing', async () => {
            const event = createEvent(undefined);

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Missing request body');
            }
        });

        it('should return 400 if webhook URL is missing', async () => {
            const event = createEvent({
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Missing webhook URL');
            }
        });

        it('should return 400 if webhook URL is invalid', async () => {
            const event = createEvent({
                webhookUrl: 'invalid-url',
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Invalid webhook URL format');
            }
        });

        it('should return 400 if shared secret is too long', async () => {
            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'a'.repeat(129), // 129 characters, which exceeds the 128 character limit
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Webhook shared secret must not exceed 128 characters');
            }
        });

        it('should return 404 if API key not found for user', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue(null);

            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(404);
                expect(JSON.parse(response.body).error).toBe('API key not found. Please create an API key first.');
            }
        });

        it('should return 204 if webhook URL and secret are unchanged', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue({
                apiKey: 'api-key-123',
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            });

            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(204);
                expect(JSON.parse(response.body)).toEqual({}); // No content
            }
        });

        it('should return 201 if webhook URL and secret are set for the first time', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue({
                apiKey: 'api-key-123',
                // No webhookUrl or sharedSecret
            });

            const mockSaveWebhook = StorageClient.saveWebhook as jest.Mock;
            mockSaveWebhook.mockResolvedValue(undefined);

            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(201); // Created
                expect(mockSaveWebhook).toHaveBeenCalledWith('test-user-id', 'https://example.com/webhook', 'secret123');
            }
        });

        it('should return 200 if webhook URL and secret are updated', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockResolvedValue({
                apiKey: 'api-key-123',
                webhookUrl: 'https://example.com/old-webhook',
                sharedSecret: 'old-secret',
            });

            const mockSaveWebhook = StorageClient.saveWebhook as jest.Mock;
            mockSaveWebhook.mockResolvedValue(undefined);

            const event = createEvent({
                webhookUrl: 'https://example.com/new-webhook',
                sharedSecret: 'new-secret',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(200); // OK
                expect(mockSaveWebhook).toHaveBeenCalledWith('test-user-id', 'https://example.com/new-webhook', 'new-secret');
            }
        });

        it('should handle errors gracefully', async () => {
            const mockGetApiKey = StorageClient.getApiKey as jest.Mock;
            mockGetApiKey.mockRejectedValue(new Error('Database error'));

            const event = createEvent({
                webhookUrl: 'https://example.com/webhook',
                sharedSecret: 'secret123',
            });

            const response = await setWebhook(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(500);
                expect(JSON.parse(response.body).error).toBe('Internal server error');
                expect(JSON.parse(response.body).message).toBe('Database error');
            }
        });
    });
});
