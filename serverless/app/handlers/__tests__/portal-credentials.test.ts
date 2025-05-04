/**
 * Tests for the portal-credentials handlers
 */
import { get, set } from '../portal-credentials';
import StorageClient from '../../../lib/StorageClient';
import PortalAuthenticator from '../../../lib/PortalAuthenticator';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../../lib/StorageClient');
jest.mock('../../../lib/PortalAuthenticator');

describe('Portal Credentials Handlers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Helper function to create API Gateway event
    const createEvent = (
        body: any = null,
        userId: string | null = 'test-user-id'
    ): Partial<APIGatewayProxyEvent> => {
        return {
            body: body ? JSON.stringify(body) : null,
            requestContext: {
                authorizer: {
                    jwt: {
                        claims: {
                            sub: userId,
                        },
                    },
                },
            } as any,
        };
    };

    describe('get', () => {
        it('should return 401 if no user ID is present', async () => {
            const event = createEvent(null, null);

            const response = (await get(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Unauthorized');
        });

        it('should return 204 if no credentials are found', async () => {
            const event = createEvent();

            // Mock StorageClient to return null (no credentials found)
            (StorageClient.getPortalCredentials as jest.Mock).mockResolvedValue(null);

            const response = (await get(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(StorageClient.getPortalCredentials).toHaveBeenCalledWith('test-user-id');
            expect(response.statusCode).toBe(204);
        });

        it('should return credentials if found', async () => {
            const event = createEvent();

            const mockCredentials = {
                username: 'test@example.com',
                isBad: false,
            };

            // Mock StorageClient to return credentials
            (StorageClient.getPortalCredentials as jest.Mock).mockResolvedValue(mockCredentials);

            const response = (await get(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(StorageClient.getPortalCredentials).toHaveBeenCalledWith('test-user-id');
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual(mockCredentials);
        });

        it('should handle errors and return 500 status', async () => {
            const event = createEvent();

            // Mock StorageClient to throw an error
            (StorageClient.getPortalCredentials as jest.Mock).mockRejectedValue(
                new Error('Test error')
            );

            const response = (await get(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.body).error).toBe('Internal server error');
            expect(JSON.parse(response.body).message).toBe('Test error');
        });
    });

    describe('set', () => {
        it('should return 401 if no user ID is present', async () => {
            const event = createEvent(
                { username: 'test@example.com', password: 'password123' },
                null
            );

            const response = (await set(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Unauthorized');
        });

        it('should return 400 if username or password is missing', async () => {
            // Missing password
            let event = createEvent({ username: 'test@example.com' });
            let response = (await set(event as any, {} as any, () => {})) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('Username and password are required');

            // Missing username
            event = createEvent({ password: 'password123' });
            response = (await set(event as any, {} as any, () => {})) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('Username and password are required');

            // Empty username
            event = createEvent({ username: '', password: 'password123' });
            response = (await set(event as any, {} as any, () => {})) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('Username and password are required');
        });

        it('should return 401 if authentication fails', async () => {
            const event = createEvent({ username: 'test@example.com', password: 'wrong-password' });

            // Mock PortalAuthenticator to return authentication failure
            (PortalAuthenticator.authenticateWithPortal as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials',
            });

            const response = (await set(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(PortalAuthenticator.authenticateWithPortal).toHaveBeenCalledWith(
                'test@example.com',
                'wrong-password',
                expect.any(Object)
            );
            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Authentication failed');
        });

        it('should store credentials and session on successful authentication', async () => {
            const event = createEvent({ username: 'test@example.com', password: 'password123' });

            // Mock cookie jar with an expiry date
            const mockCookieJar = {
                toJSON: jest.fn().mockReturnValue({
                    cookies: [
                        {
                            key: 'session',
                            value: 'test-cookie-value',
                            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        },
                    ],
                }),
            };

            // Mock PortalAuthenticator to return successful authentication
            (PortalAuthenticator.authenticateWithPortal as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: mockCookieJar,
            });

            // Mock StorageClient and PortalAuthenticator methods
            (StorageClient.savePortalCredentials as jest.Mock).mockResolvedValue(undefined);
            (PortalAuthenticator.saveUserSession as jest.Mock).mockResolvedValue(undefined);

            const response = (await set(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            // Verify authentication was attempted
            expect(PortalAuthenticator.authenticateWithPortal).toHaveBeenCalledWith(
                'test@example.com',
                'password123',
                expect.any(Object)
            );

            // Verify credentials were stored
            expect(StorageClient.savePortalCredentials).toHaveBeenCalledWith(
                'test-user-id',
                'test@example.com',
                'password123'
            );

            // Verify session was stored
            expect(PortalAuthenticator.saveUserSession).toHaveBeenCalledWith(
                'test-user-id',
                JSON.stringify(mockCookieJar.toJSON())
            );

            // Verify response
            expect(response.statusCode).toBe(201);
            expect(JSON.parse(response.body).message).toBe('Credentials stored successfully');
            expect(JSON.parse(response.body).username).toBe('test@example.com');
        });

        it('should handle authentication errors', async () => {
            const event = createEvent({ username: 'test@example.com', password: 'password123' });

            // Mock PortalAuthenticator to throw an error
            (PortalAuthenticator.authenticateWithPortal as jest.Mock).mockRejectedValue(
                new Error('Network error')
            );

            const response = (await set(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            // Check for 401 status because authentication errors are handled by the authenticatePortal function
            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Authentication failed');
            expect(JSON.parse(response.body).message).toContain('Network error');
        });
    });
});
