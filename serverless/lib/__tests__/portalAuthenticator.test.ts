/**
 * Tests for the PortalAuthenticator module
 */
import PortalAuthenticator from '../PortalAuthenticator';
import StorageClient from '../StorageClient';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';

// Mock the dependencies
jest.mock('axios');
jest.mock('axios-cookiejar-support', () => ({
    wrapper: jest.fn(axios => axios),
}));

// Create a more complete mock of the tough-cookie module
jest.mock('tough-cookie', () => {
    const mockCookieJar = {
        setCookieSync: jest.fn(),
        getCookiesSync: jest.fn(() => []),
        toJSON: jest.fn(() => ({ cookies: [] })),
    };

    // Create constructor function correctly
    function MockCookieJar() {
        return mockCookieJar;
    }

    // Add static method to constructor function
    MockCookieJar.fromJSON = jest.fn().mockImplementation(() => mockCookieJar);

    return {
        CookieJar: MockCookieJar,
    };
});

jest.mock('../StorageClient', () => ({
    getUserSession: jest.fn(),
    sensitiveGetPortalCredentials: jest.fn(),
    saveCaseMetadata: jest.fn(),
    getCaseMetadata: jest.fn(),
    saveUserSession: jest.fn(),
}));

// Set environment variable before importing the module
process.env.PORTAL_URL = 'https://test-portal.example.com';

describe('PortalAuthenticator', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('Public API', () => {
        it('should export the expected methods', () => {
            expect(typeof PortalAuthenticator.authenticateWithPortal).toBe('function');
            expect(typeof PortalAuthenticator.verifySession).toBe('function');
            expect(typeof PortalAuthenticator.getOrCreateUserSession).toBe('function');
        });
    });

    describe('authenticateWithPortal', () => {
        it('should return error if PORTAL_URL is not set', async () => {
            // Temporarily remove the environment variable
            const originalUrl = process.env.PORTAL_URL;
            delete process.env.PORTAL_URL;

            const result = await PortalAuthenticator.authenticateWithPortal('username', 'password');

            // Restore environment variable
            process.env.PORTAL_URL = originalUrl;

            expect(result.success).toBe(false);
            expect(result.message).toBeDefined();
            expect(result.cookieJar).toBeUndefined();
        });

        it('should make the proper requests for authentication', async () => {
            // Mock axios methods
            const mockGet = jest.fn().mockResolvedValue({
                data: '<input name="__RequestVerificationToken" value="test-token" />',
                request: { res: { responseUrl: 'https://test-login.example.com' } },
            });

            const mockPost = jest
                .fn()
                // First post call (login form)
                .mockResolvedValueOnce({
                    data: '<input name="wresult" value="test-wsfed-token" />',
                    request: { res: { responseUrl: 'https://test-federation.example.com' } },
                })
                // Second post call (federation completion)
                .mockResolvedValueOnce({
                    data: 'Welcome, TestUser',
                    headers: {},
                });

            // @ts-ignore - need to mock the axios create method
            axios.create.mockReturnValue({
                get: mockGet,
                post: mockPost,
            });

            // Mock the CookieJar.getCookiesSync to return session cookies for session validation
            const mockCookies = [
                {
                    key: 'FedAuth',
                    value: 'test-token',
                    domain: 'portal.example.com',
                    path: '/',
                },
                {
                    key: 'FedAuth1',
                    value: 'test-token',
                    domain: 'portal.example.com',
                    path: '/',
                },
            ];

            // @ts-ignore - update the getCookiesSync mock for this test
            CookieJar().getCookiesSync.mockReturnValue(mockCookies);

            const result = await PortalAuthenticator.authenticateWithPortal('testuser', 'password');

            expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/Portal/Account/Login'));
            expect(mockPost).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
            expect(result.cookieJar).toBeDefined();
        });
    });

    describe('getOrCreateUserSession', () => {
        it('should return existing session if available', async () => {
            const mockSessionJson = { cookies: [{ key: 'FedAuth', value: 'test' }] };

            // @ts-ignore - mock implementation
            StorageClient.getUserSession.mockResolvedValue(JSON.stringify(mockSessionJson));

            const result = await PortalAuthenticator.getOrCreateUserSession('test-user');

            expect(StorageClient.getUserSession).toHaveBeenCalledWith('test-user');
            expect(result.success).toBe(true);
            expect(result.cookieJar).toBeDefined();
        });

        it('should try to create a new session if none exists', async () => {
            // No existing session
            // @ts-ignore - mock implementation
            StorageClient.getUserSession.mockResolvedValue(null);

            // Mock credentials available
            // @ts-ignore - mock implementation
            StorageClient.sensitiveGetPortalCredentials.mockResolvedValue({
                username: 'testuser',
                password: 'password',
                isBad: false,
            });

            // Mock the authenticateWithPortal method
            const mockCookieJar = new CookieJar();
            const authenticateSpy = jest.spyOn(PortalAuthenticator, 'authenticateWithPortal').mockResolvedValue({
                success: true,
                cookieJar: mockCookieJar,
            });

            const result = await PortalAuthenticator.getOrCreateUserSession('test-user');

            expect(StorageClient.sensitiveGetPortalCredentials).toHaveBeenCalledWith('test-user');
            expect(authenticateSpy).toHaveBeenCalledWith('testuser', 'password', expect.any(Object));
            expect(result.success).toBe(true);
            expect(result.cookieJar).toBe(mockCookieJar);

            // Restore the original method
            authenticateSpy.mockRestore();
        });

        it('should return error if no credentials found', async () => {
            // No existing session
            // @ts-ignore - mock implementation
            StorageClient.getUserSession.mockResolvedValue(null);

            // No credentials available
            // @ts-ignore - mock implementation
            StorageClient.sensitiveGetPortalCredentials.mockResolvedValue(null);

            const result = await PortalAuthenticator.getOrCreateUserSession('test-user');

            expect(result.success).toBe(false);
            expect(result.message).toBeDefined();
            expect(result.cookieJar).toBeUndefined();
        });
    });

    describe('verifySession', () => {
        it('should return false if PORTAL_URL is not set', async () => {
            // Temporarily remove the environment variable
            const originalUrl = process.env.PORTAL_URL;
            delete process.env.PORTAL_URL;

            const mockJar = new CookieJar();
            const result = await PortalAuthenticator.verifySession(mockJar);

            // Restore environment variable
            process.env.PORTAL_URL = originalUrl;

            expect(result).toBe(false);
        });

        it('should check for welcome message in response', async () => {
            const mockJar = new CookieJar();

            // Mock axios get method to return welcome message
            const mockGet = jest.fn().mockResolvedValue({
                data: 'Welcome, TestUser',
                status: 200,
            });

            // @ts-ignore - need to mock the axios create method
            axios.create.mockReturnValue({
                get: mockGet,
            });

            const result = await PortalAuthenticator.verifySession(mockJar);

            expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/Portal'), expect.any(Object));
            expect(result).toBe(true);
        });

        it('should return false if session appears invalid', async () => {
            const mockJar = new CookieJar();

            // Mock axios get method to return sign in page
            const mockGet = jest.fn().mockResolvedValue({
                data: 'Sign In to your account',
                status: 200,
            });

            // @ts-ignore - need to mock the axios create method
            axios.create.mockReturnValue({
                get: mockGet,
            });

            const result = await PortalAuthenticator.verifySession(mockJar);

            expect(result).toBe(false);
        });
    });
});
