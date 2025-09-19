/**
 * Tests for the CaseProcessor module
 */
import CaseProcessor from '../CaseProcessor';
import QueueClient from '../QueueClient';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';

// Mock dependencies
jest.mock('../PortalAuthenticator');
jest.mock('../QueueClient');
jest.mock('../StorageClient');
jest.mock('axios');
jest.mock('axios-cookiejar-support', () => ({
    wrapper: jest.fn(axios => axios),
}));
jest.mock('tough-cookie');

// Mock environment variable
process.env.PORTAL_URL = 'https://test-portal.example.com';

describe('CaseProcessor', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('fetchCaseIdFromPortal', () => {
        it('should return error if PORTAL_URL is not set', async () => {
            // Temporarily remove the environment variable
            const originalUrl = process.env.PORTAL_URL;
            delete process.env.PORTAL_URL;

            const mockJar = new CookieJar();
            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            // Restore environment variable
            process.env.PORTAL_URL = originalUrl;

            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(true);
        });

        it('should make requests to search for a case and extract the case ID', async () => {
            const mockJar = new CookieJar();
            const mockCaseId = '123ABC456DEF';

            // Mock axios post/get methods
            const mockPost = jest.fn().mockResolvedValue({
                status: 200,
                data: 'search form submitted',
            });

            const mockGet = jest.fn().mockResolvedValue({
                status: 200,
                data: `<html><body><a class="caseLink" data-caseid="${mockCaseId}">Case Link</a></body></html>`,
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: mockGet,
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(mockPost).toHaveBeenCalledWith(
                expect.stringContaining('/Portal/SmartSearch/SmartSearch/SmartSearch'),
                expect.any(URLSearchParams)
            );
            expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/Portal/SmartSearch/SmartSearchResults'));
            expect(result.caseId).toBe(mockCaseId);
            expect(result.error).toBeUndefined();
        });

        it('should return error with isSystemError=false if no case links are found', async () => {
            const mockJar = new CookieJar();

            // Mock axios post/get methods
            const mockPost = jest.fn().mockResolvedValue({
                status: 200,
                data: 'search form submitted',
            });

            const mockGet = jest.fn().mockResolvedValue({
                status: 200,
                data: '<html><body>No cases found</body></html>', // No caseLink elements
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: mockGet,
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(false); // Not a system error, a legitimate "not found"
        });

        it('should return error with isSystemError=true if the search request fails', async () => {
            const mockJar = new CookieJar();

            // Mock axios post method to fail
            const mockPost = jest.fn().mockResolvedValue({
                status: 500,
                data: 'server error',
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: jest.fn(),
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(mockPost).toHaveBeenCalled();
            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(true);
        });
    });

    describe('queueCasesForSearch', () => {
        // We'll test the queueCasesForSearch function which is the correct one according to our implementation

        it('should queue cases for search', async () => {
            // @ts-ignore - mock implementation
            QueueClient.queueCasesForSearch.mockResolvedValue(undefined);

            const cases = ['22CR123456-789', '23CV654321-456'];
            const userId = 'test-user';

            await CaseProcessor.queueCasesForSearch(cases, userId);

            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith(cases, userId);
        });
    });
});
