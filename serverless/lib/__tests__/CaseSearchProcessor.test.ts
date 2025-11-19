/**
 * Tests for CaseSearchProcessor
 */
import { processCaseSearchRequest } from '../CaseSearchProcessor';
import StorageClient from '../StorageClient';
import QueueClient from '../QueueClient';
import PortalAuthenticator from '../PortalAuthenticator';
import { SearchResult, CaseSearchRequest, ZipCase, CaseSummary } from '../../../shared/types';
import { CASE_SUMMARY_VERSION_DATE } from '../CaseProcessor';

const lastUpdatedAfterVersion = (offsetMs = 1000): string => new Date(CASE_SUMMARY_VERSION_DATE.getTime() + offsetMs).toISOString();

// Mock dependencies
jest.mock('../StorageClient');
jest.mock('../QueueClient');
jest.mock('../PortalAuthenticator');

const mockStorageClient = StorageClient as jest.Mocked<typeof StorageClient>;
const mockQueueClient = QueueClient as jest.Mocked<typeof QueueClient>;
const mockPortalAuthenticator = PortalAuthenticator as jest.Mocked<typeof PortalAuthenticator>;

describe('CaseSearchProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Default mock for portal authenticator
        mockPortalAuthenticator.getOrCreateUserSession.mockResolvedValue({
            success: true,
            cookieJar: {} as any,
            message: 'Session created',
        });
    });

    describe('processCaseSearchRequest', () => {
        const baseRequest: CaseSearchRequest = {
            input: '22CR123456-789',
            userId: 'test-user-id',
            userAgent: 'Test Agent',
        };

        it('should handle cases with complete status and summary (no action needed)', async () => {
            const caseSummary: CaseSummary = {
                caseName: 'Test vs State',
                court: 'Test Court',
                charges: [],
                filingAgency: null,
            };

            const completeCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'complete' },
                    // Ensure lastUpdated is after CASE_SUMMARY_VERSION_DATE so tests treat the summary as up-to-date
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': completeCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            expect(result.results['22CR123456-789']).toEqual(completeCase);
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
            expect(mockQueueClient.queueCasesForSearch).not.toHaveBeenCalled();
            expect(mockStorageClient.saveCase).not.toHaveBeenCalled();
        });

        it('should handle cases with complete status but missing summary (should treat as found)', async () => {
            const incompleteCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'complete' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined, // Missing summary
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': incompleteCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should update status to 'found'
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '22CR123456-789',
                caseId: 'test-case-id',
                fetchStatus: { status: 'found' },
                lastUpdated: expect.any(String),
            });

            // Should queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith('22CR123456-789', 'test-case-id', 'test-user-id');

            // Should not queue for search
            expect(mockQueueClient.queueCasesForSearch).not.toHaveBeenCalled();

            // Verify the returned result also has the updated status
            expect(result.results['22CR123456-789'].zipCase.fetchStatus.status).toBe('found');
            expect(result.results['22CR123456-789'].zipCase.lastUpdated).toBeDefined();
        });

        it('should handle cases with complete status but missing caseId (should re-queue for search)', async () => {
            const invalidCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: undefined, // Missing caseId
                    fetchStatus: { status: 'complete' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': invalidCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for search since caseId is missing
            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');

            // Should not queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
        });

        it('should handle cases with found status and caseId (should queue for data retrieval)', async () => {
            const foundCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'found' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': foundCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith('22CR123456-789', 'test-case-id', 'test-user-id');

            // Should not queue for search
            expect(mockQueueClient.queueCasesForSearch).not.toHaveBeenCalled();
        });

        it('should handle cases with reprocessing status and caseId (should queue for data retrieval)', async () => {
            const reprocessingCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'reprocessing', tryCount: 1 },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': reprocessingCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for data retrieval like 'found' status
            expect(mockQueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith('22CR123456-789', 'test-case-id', 'test-user-id');

            // Should not queue for search
            expect(mockQueueClient.queueCasesForSearch).not.toHaveBeenCalled();
        });

        it('should handle cases with found status but missing caseId', async () => {
            const foundCaseNoCaseId: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: undefined, // Missing caseId
                    fetchStatus: { status: 'found' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': foundCaseNoCaseId,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for search since caseId is missing
            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');

            // Should not queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
        });

        it('should handle cases with processing status (should re-queue for processing)', async () => {
            const processingCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'processing' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': processingCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for search (processing cases get re-queued in case they're stuck)
            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
            // Status should be saved to DynamoDB as 'queued'
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '22CR123456-789',
                fetchStatus: { status: 'queued' },
                caseId: 'test-case-id',
                lastUpdated: expect.any(String),
            });
        });

        it('should handle cases with notFound status (should queue for search retry)', async () => {
            const notFoundCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: undefined,
                    fetchStatus: { status: 'notFound' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': notFoundCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for search retry, in case the record is not actually in-queue
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');
            // Status should be saved to DynamoDB as 'queued'
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '22CR123456-789',
                fetchStatus: { status: 'queued' },
                caseId: undefined,
                lastUpdated: expect.any(String),
            });
            // Status should be updated to 'queued' in the response for the UI
            expect(result.results['22CR123456-789'].zipCase.fetchStatus.status).toBe('queued');
        });

        it('should handle cases with failed status (should queue for search)', async () => {
            const failedCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: undefined,
                    fetchStatus: { status: 'failed', message: 'Test failure' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': failedCase,
            });

            const result = await processCaseSearchRequest(baseRequest);

            // Should queue for search (failed status gets re-queued)
            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');
            expect(mockQueueClient.queueCaseForDataRetrieval).not.toHaveBeenCalled();
            // Status should be saved to DynamoDB as 'queued'
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '22CR123456-789',
                fetchStatus: { status: 'queued' },
                caseId: undefined,
                lastUpdated: expect.any(String),
            });
            // Status should be updated to 'queued' in the response for the UI
            expect(result.results['22CR123456-789'].zipCase.fetchStatus.status).toBe('queued');
        });

        it('should handle new cases (not in storage)', async () => {
            mockStorageClient.getSearchResults.mockResolvedValue({});

            const result = await processCaseSearchRequest(baseRequest);

            // Should create and queue new case
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '22CR123456-789',
                fetchStatus: { status: 'queued' },
            });

            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['22CR123456-789'], 'test-user-id', 'Test Agent');
        });

        it('should handle mixed case scenarios', async () => {
            const caseSummary: CaseSummary = {
                caseName: 'Test vs State',
                court: 'Test Court',
                charges: [],
                filingAgency: null,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': {
                    zipCase: {
                        caseNumber: '22CR123456-789',
                        caseId: 'case-id-1',
                        fetchStatus: { status: 'complete' },
                        lastUpdated: lastUpdatedAfterVersion(),
                    } as ZipCase,
                    caseSummary, // Has summary - truly complete
                },
                '23CV654321-456': {
                    zipCase: {
                        caseNumber: '23CV654321-456',
                        caseId: 'case-id-2',
                        fetchStatus: { status: 'complete' },
                        lastUpdated: lastUpdatedAfterVersion(),
                    } as ZipCase,
                    caseSummary: undefined, // Missing summary - should be treated as found
                },
                '24CV789012-345': {
                    zipCase: {
                        caseNumber: '24CV789012-345',
                        caseId: 'case-id-3',
                        fetchStatus: { status: 'found' },
                        lastUpdated: lastUpdatedAfterVersion(),
                    } as ZipCase,
                    caseSummary: undefined,
                },
            });

            const multiCaseRequest: CaseSearchRequest = {
                input: '22CR123456-789 23CV654321-456 24CV789012-345 25CR555666-777',
                userId: 'test-user-id',
                userAgent: 'Test Agent',
            };

            const result = await processCaseSearchRequest(multiCaseRequest);

            // First case (complete with summary) - no action
            expect(mockStorageClient.saveCase).not.toHaveBeenCalledWith(expect.objectContaining({ caseNumber: '22CR123456-789' }));

            // Second case (complete without summary) - should update to found
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '23CV654321-456',
                caseId: 'case-id-2',
                fetchStatus: { status: 'found' },
                lastUpdated: expect.any(String),
            });

            // Third case (already found) - queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith('24CV789012-345', 'case-id-3', 'test-user-id');

            // Second case (now found) - queue for data retrieval
            expect(mockQueueClient.queueCaseForDataRetrieval).toHaveBeenCalledWith('23CV654321-456', 'case-id-2', 'test-user-id');

            // Fourth case (new) - should be created and queued for search
            expect(mockStorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber: '25CR555666-777',
                fetchStatus: { status: 'queued' },
            });

            expect(mockQueueClient.queueCasesForSearch).toHaveBeenCalledWith(['25CR555666-777'], 'test-user-id', 'Test Agent');

            // Verify returned statuses in the results object
            expect(result.results['22CR123456-789'].zipCase.fetchStatus.status).toBe('complete');
            expect(result.results['23CV654321-456'].zipCase.fetchStatus.status).toBe('found'); // Updated from complete
            expect(result.results['24CV789012-345'].zipCase.fetchStatus.status).toBe('found');
        });

        it('should handle queue errors gracefully', async () => {
            const foundCase: SearchResult = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    caseId: 'test-case-id',
                    fetchStatus: { status: 'found' },
                    lastUpdated: lastUpdatedAfterVersion(),
                } as ZipCase,
                caseSummary: undefined,
            };

            mockStorageClient.getSearchResults.mockResolvedValue({
                '22CR123456-789': foundCase,
            });

            // Mock queue failure
            mockQueueClient.queueCaseForDataRetrieval.mockRejectedValue(new Error('Queue error'));

            // Should not throw - should handle error gracefully
            const result = await processCaseSearchRequest(baseRequest);

            expect(result.results['22CR123456-789']).toEqual(foundCase);
        });
    });
});
