/**
 * Tests for the SearchProcessor module
 */
import * as SearchProcessor from '../SearchProcessor';
import StorageClient from '../StorageClient';
import SearchParser from '../SearchParser';
import QueueClient from '../QueueClient';
import PortalAuthenticator from '../PortalAuthenticator';
import { SearchRequest } from '../../../shared/types';

// Mock dependencies
jest.mock('../StorageClient');
jest.mock('../SearchParser');
jest.mock('../QueueClient');
jest.mock('../PortalAuthenticator');

describe('SearchProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processSearchRequest', () => {
        // Set up default mock behavior
        beforeEach(() => {
            // Default SearchParser mock
            (SearchParser.parseSearchInput as jest.Mock).mockReturnValue(['22CR123456-789']);

            // Default StorageClient mocks
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue({});
            (StorageClient.saveCase as jest.Mock).mockResolvedValue(undefined);

            // Default QueueClient mock
            (QueueClient.queueCasesForSearch as jest.Mock).mockResolvedValue(undefined);
            (QueueClient.queueCaseForDataRetrieval as jest.Mock).mockResolvedValue(undefined);

            // Default PortalAuthenticator mock
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: { toJSON: () => ({ cookies: [] }) },
            });
        });

        it('should return empty results for empty input', async () => {
            // Override the SearchParser mock to return empty array
            (SearchParser.parseSearchInput as jest.Mock).mockReturnValue([]);

            const req: SearchRequest = {
                input: '',
                userId: 'test-user',
            };

            const result = await SearchProcessor.processSearchRequest(req);

            expect(result).toEqual({ results: {} });
            expect(StorageClient.getSearchResults).not.toHaveBeenCalled();
        });

        it('should queue new cases for processing', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            const result = await SearchProcessor.processSearchRequest(req);

            expect(StorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber,
                fetchStatus: { status: 'queued' },
            });

            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith([caseNumber], req.userId, req.userAgent);

            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('queued');
        });

        it('should preserve status for cases in terminal states', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Set up mock for existing case in complete state
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue({
                [caseNumber]: {
                    zipCase: {
                        caseNumber,
                        fetchStatus: { status: 'complete' },
                    },
                },
            });

            const result = await SearchProcessor.processSearchRequest(req);

            // Should not queue already complete cases
            expect(QueueClient.queueCasesForSearch).not.toHaveBeenCalled();

            // Result should include the existing case with its status preserved
            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('complete');
        });

        it('should queue data retrieval for cases with found status', async () => {
            const caseNumber = '22CR123456-789';
            const caseId = 'test-case-id';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Set up mock for existing case in found state
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue({
                [caseNumber]: {
                    zipCase: {
                        caseNumber,
                        caseId,
                        fetchStatus: { status: 'found' },
                    },
                },
            });

            const result = await SearchProcessor.processSearchRequest(req);

            // Should not queue for search but queue for data retrieval
            expect(QueueClient.queueCasesForSearch).not.toHaveBeenCalled();
            expect(QueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith(
                caseNumber,
                caseId,
                req.userId
            );

            // Result should include the existing case with its status preserved
            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('found');
        });

        it('should authenticate with portal if no session exists', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Mock PortalAuthenticator.getOrCreateUserSession to simulate successful auth
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: { toJSON: () => ({ cookies: [] }) },
            });

            const result = await SearchProcessor.processSearchRequest(req);

            // Should call getOrCreateUserSession with the right parameters
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                req.userId,
                req.userAgent
            );

            // Should queue cases after authentication
            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith([caseNumber], req.userId, req.userAgent);

            // Result should include the case with queued status
            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('queued');
        });

        it('should mark cases as failed if authentication fails', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Mock failed authentication with getOrCreateUserSession
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials',
            });

            const result = await SearchProcessor.processSearchRequest(req);

            // Should call getOrCreateUserSession
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                req.userId,
                req.userAgent
            );

            // Should not queue cases after authentication failure
            expect(QueueClient.queueCasesForSearch).not.toHaveBeenCalled();

            // Result should include the case with failed status
            expect(result.results).toHaveProperty(caseNumber);
            const fetchStatus = result.results[caseNumber].zipCase.fetchStatus;
            expect(fetchStatus.status).toBe('failed');
            expect('message' in fetchStatus && fetchStatus.message).toContain(
                'Authentication failed'
            );
        });

        it('should mark cases as failed if no portal credentials exist', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Mock getOrCreateUserSession to return failure for missing credentials
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'No portal credentials found for user',
            });

            const result = await SearchProcessor.processSearchRequest(req);

            // Should not queue cases if no credentials
            expect(QueueClient.queueCasesForSearch).not.toHaveBeenCalled();

            // Result should include the case with failed status
            expect(result.results).toHaveProperty(caseNumber);
            const fetchStatus = result.results[caseNumber].zipCase.fetchStatus;
            expect(fetchStatus.status).toBe('failed');
            expect('message' in fetchStatus && fetchStatus.message).toContain(
                'Authentication failed'
            );
        });

        it('should handle errors during case processing', async () => {
            const caseNumber = '22CR123456-789';
            const req: SearchRequest = {
                input: caseNumber,
                userId: 'test-user',
            };

            // Make StorageClient.saveCase throw an error for this test
            (StorageClient.saveCase as jest.Mock).mockRejectedValue(new Error('Test error'));

            const result = await SearchProcessor.processSearchRequest(req);

            // Should still return results with failed status
            expect(result.results).toHaveProperty(caseNumber);
            const fetchStatus = result.results[caseNumber].zipCase.fetchStatus;
            expect(fetchStatus.status).toBe('failed');
        });

        it('should deduplicate case numbers in the input', async () => {
            // Mock parser to return duplicate case numbers
            (SearchParser.parseSearchInput as jest.Mock).mockReturnValue([
                '22CR123456-789',
                '22CR123456-789',
                '23CV654321-456',
            ]);

            // Make sure getOrCreateUserSession succeeds
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: { toJSON: () => ({ cookies: [] }) },
            });

            const req: SearchRequest = {
                input: '22CR123456-789 22CR123456-789 23CV654321-456',
                userId: 'test-user',
            };

            await SearchProcessor.processSearchRequest(req);

            // Should only queue unique case numbers
            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith(
                ['22CR123456-789', '23CV654321-456'],
                req.userId,
                req.userAgent
            );
        });
    });
});
