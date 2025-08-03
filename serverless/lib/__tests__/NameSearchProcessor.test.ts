/**
 * Tests for the NameSearchProcessor module
 */
// Mock the NameSearchPortalClient module
jest.mock('../NameSearchPortalClient');

// Import the mocked module
import * as NameSearchPortalClient from '../NameSearchPortalClient';

// Convert to mocked type for better TypeScript support
const mockedNameSearchPortalClient = NameSearchPortalClient as jest.Mocked<
    typeof NameSearchPortalClient
>;

// Import the actual implementations for testing
const {
    processNameSearchRequest,
    getNameSearchResults,
    processNameSearchRecord
} = jest.requireActual('../NameSearchProcessor');

// Import other dependencies
import StorageClient from '../StorageClient';
import PortalAuthenticator from '../PortalAuthenticator';
import QueueClient from '../QueueClient';
import AlertService from '../AlertService';

// Mock only the essential dependencies
jest.mock('../StorageClient');
jest.mock('../PortalAuthenticator');
jest.mock('../QueueClient');
jest.mock('../AlertService');

describe('NameSearchProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Setup StorageClient mock
        (StorageClient.saveNameSearch as jest.Mock).mockResolvedValue(undefined);

        // Set up default mock for fetchCasesByName
        mockedNameSearchPortalClient.fetchCasesByName.mockResolvedValue({
            cases: [],
            error: undefined,
        });
    });

    afterEach(() => {
        // Reset mocks
        jest.clearAllMocks();
    });

    describe('processNameSearchRequest', () => {
        it('should propagate criminalOnly flag to QueueClient.queueNameSearch', async () => {
            // Mock successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {},
            });

            // Mock successful queue operation
            (QueueClient.queueNameSearch as jest.Mock).mockResolvedValue(undefined);

            const result = await processNameSearchRequest(
                {
                    name: 'Jane Doe',
                    soundsLike: false,
                    dateOfBirth: '1990-02-02',
                    userAgent: 'test-user-agent',
                    criminalOnly: true,
                },
                'test-user-id'
            );

            expect(result).toMatchObject({
                searchId: expect.any(String),
                results: {},
                success: true,
            });

            // Assert that QueueClient.queueNameSearch was called with criminalOnly true
            expect(QueueClient.queueNameSearch).toHaveBeenCalledWith(
                expect.any(String), // searchId
                'Doe, Jane', // name
                'test-user-id', // userId
                '1990-02-02', // dateOfBirth
                false, // soundsLike
                true, // criminalOnly
                'test-user-agent' // userAgent
            );
        });
        it('should return failure when name parsing fails', async () => {
            const result = await processNameSearchRequest(
                { name: '', soundsLike: false },
                'test-user-id'
            );

            expect(result).toMatchObject({
                searchId: expect.any(String),
                results: {},
                success: false,
            });

            // Check that the error message starts with the expected text
            expect(result.error).toMatch(/^Name could not be parsed from input \[\]/);

            // Verify StorageClient was called to save the failed search
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    originalName: '',
                    normalizedName: '',
                    status: 'failed',
                    soundsLike: false,
                    dateOfBirth: undefined,
                    cases: [],
                }),
                expect.any(Number)
            );
        });

        it('should return failure when authentication fails', async () => {
            // Mock a failed authentication response
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Authentication error: Invalid credentials',
            });

            const result = await processNameSearchRequest(
                { name: 'John Smith', soundsLike: false },
                'test-user-id'
            );

            expect(result).toMatchObject({
                searchId: expect.any(String),
                results: {},
                success: false,
            });

            // The error message should match what was returned from the authenticator
            expect(result.error).toBe('Authentication error: Invalid credentials');

            // Verify StorageClient was called to save the failed search
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    originalName: 'John Smith',
                    normalizedName: 'Smith, John',
                    status: 'failed',
                    soundsLike: false,
                    dateOfBirth: undefined,
                    cases: [],
                }),
                expect.any(Number)
            );

            // Verify that PortalAuthenticator was called
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                'test-user-id',
                undefined
            );
        });

        it('should queue name search when everything succeeds', async () => {
            // Mock successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {},
            });

            // Mock successful queue operation
            (QueueClient.queueNameSearch as jest.Mock).mockResolvedValue(undefined);

            const result = await processNameSearchRequest(
                {
                    name: 'John Smith',
                    soundsLike: false,
                    dateOfBirth: '1980-01-01',
                    userAgent: 'test-user-agent',
                },
                'test-user-id'
            );

            // Verify the result
            expect(result).toMatchObject({
                searchId: expect.any(String),
                results: {},
                success: true,
            });

            // Explicitly check that error is not defined
            expect(result.error).toBeUndefined();

            // Verify StorageClient was called to save the search with 'queued' status
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    originalName: 'John Smith',
                    normalizedName: 'Smith, John',
                    status: 'queued',
                    soundsLike: false,
                    dateOfBirth: '1980-01-01',
                    cases: [],
                }),
                expect.any(Number)
            );

            // Verify the queue client was called with the expected parameters
            expect(QueueClient.queueNameSearch).toHaveBeenCalledWith(
                expect.any(String), // searchId
                'Smith, John', // name
                'test-user-id', // userId
                '1980-01-01', // dateOfBirth
                false, // soundsLike
                undefined, // criminalOnly
                'test-user-agent' // userAgent
            );

            // Verify PortalAuthenticator was called
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                'test-user-id',
                'test-user-agent'
            );
        });
    });

    describe('getNameSearchResults', () => {
        it('should return empty results when no search data exists', async () => {
            // Mock StorageClient to return no data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);

            const searchId = 'test-search-id';
            const result = await getNameSearchResults(searchId);

            // Verify the result structure
            expect(result).toMatchObject({
                searchId,
                results: {},
            });

            // Verify StorageClient was called with the right searchId
            expect(StorageClient.getNameSearch).toHaveBeenCalledWith(searchId);

            // Verify getSearchResults was not called
            expect(StorageClient.getSearchResults).not.toHaveBeenCalled();
        });

        it('should return error when search has failed status', async () => {
            // Mock StorageClient to return a failed search
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue({
                status: 'failed',
                message: 'Search failed due to an error',
                cases: [],
            });

            const searchId = 'test-search-id';
            const result = await getNameSearchResults(searchId);

            // Verify the result structure
            expect(result).toMatchObject({
                searchId,
                results: {},
                success: false,
                error: 'Search failed due to an error',
            });

            // Verify StorageClient was called with the right searchId
            expect(StorageClient.getNameSearch).toHaveBeenCalledWith(searchId);
        });

        it('should return results when search is successful', async () => {
            // Mock case numbers
            const caseNumbers = ['23CR123456', '23CR654321'];

            // Mock StorageClient to return a successful search with cases
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue({
                status: 'complete',
                cases: caseNumbers,
            });

            // Mock search results
            const mockSearchResults = {
                '23CR123456': {
                    zipCase: {
                        caseNumber: '23CR123456',
                        fetchStatus: { status: 'complete' },
                    },
                },
                '23CR654321': {
                    zipCase: {
                        caseNumber: '23CR654321',
                        fetchStatus: { status: 'complete' },
                    },
                },
            };

            // Mock getSearchResults to return mock results
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue(mockSearchResults);

            const searchId = 'test-search-id';
            const result = await getNameSearchResults(searchId);

            // Verify the result structure
            expect(result).toMatchObject({
                searchId,
                results: mockSearchResults,
                success: true,
            });

            // No error should be present
            expect(result.error).toBeUndefined();

            // Verify StorageClient methods were called correctly
            expect(StorageClient.getNameSearch).toHaveBeenCalledWith(searchId);
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith(caseNumbers);
        });
    });

    describe('processNameSearchRecord', () => {
        // Create a mock logger for all tests in this block
        const mockLogger = {
            error: jest.fn().mockResolvedValue(undefined),
            critical: jest.fn().mockResolvedValue(undefined),
            info: jest.fn().mockResolvedValue(undefined),
            warn: jest.fn().mockResolvedValue(undefined),
        };

        beforeEach(() => {
            // Set up AlertService mock to return our mock logger
            (AlertService.forCategory as jest.Mock).mockReturnValue(mockLogger);

            // Reset mocks specific to these tests
            mockLogger.error.mockClear();
            mockLogger.critical.mockClear();
        });

        it('should delete message when search data is not found', async () => {
            // Mock StorageClient to return no data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,        // dateOfBirth
                false,            // soundsLike
                undefined,        // criminalOnly
                'test-user-agent' // userAgent
            );

            // Verify StorageClient.getNameSearch was called
            expect(StorageClient.getNameSearch).toHaveBeenCalledWith(searchId);

            // Verify StorageClient.saveNameSearch was NOT called
            expect(StorageClient.saveNameSearch).not.toHaveBeenCalled();

            // Verify QueueClient.deleteMessage was called with the right parameters
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });

        it('should handle authentication failure with invalid credentials', async () => {
            const mockNameSearch = {
                normalizedName: 'Smith, John',
                cases: [],
            };

            // Mock StorageClient to return the search data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            // Mock PortalAuthenticator to return authentication failure
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid Email or password',
            });

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,        // dateOfBirth
                false,            // soundsLike
                undefined,        // criminalOnly
                'test-user-agent' // userAgent
            );

            // Verify StorageClient.getNameSearch was called
            expect(StorageClient.getNameSearch).toHaveBeenCalledWith(searchId);

            // Verify StorageClient.saveNameSearch was called twice
            // First to update status to 'processing'
            expect(StorageClient.saveNameSearch).toHaveBeenNthCalledWith(
                1,
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'processing',
                })
            );

            // Second to update status to 'failed' with the error message
            expect(StorageClient.saveNameSearch).toHaveBeenNthCalledWith(
                2,
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'failed',
                    message: 'Authentication failed: Invalid Email or password',
                })
            );

            // Verify PortalAuthenticator was called
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                userId,
                'test-user-agent'
            );

            // Verify logger.error was called
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid Email or password'),
                undefined,
                expect.objectContaining({
                    userId,
                    searchId,
                })
            );

            // Verify QueueClient.deleteMessage was called
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });

        it('should handle authentication failure with missing cookie jar', async () => {
            const mockNameSearch = {
                normalizedName: 'Smith, John',
                cases: [],
            };

            // Mock StorageClient to return the search data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            // Mock PortalAuthenticator to return success but no cookieJar
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true, // Success is true but cookieJar is missing
                // No cookieJar property
            });

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,        // dateOfBirth
                false,            // soundsLike
                undefined,        // criminalOnly
                'test-user-agent' // userAgent
            );

            // Verify StorageClient.saveNameSearch was called for the failure
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'failed',
                    message:
                        'Authentication failed: No session CookieJar found for user test-user-id',
                })
            );

            // Verify logger.critical was called
            expect(mockLogger.critical).toHaveBeenCalledWith(
                expect.stringContaining('No session CookieJar found for user test-user-id'),
                undefined,
                expect.objectContaining({
                    userId,
                    searchId,
                })
            );

            // Verify QueueClient.deleteMessage was called
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });

        it('should handle case where fetchCasesByName returns an error', async () => {
            // Mock search data
            const mockNameSearch = {
                normalizedName: 'Smith, John',
                cases: [],
            };

            // Mock StorageClient to return the search data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            // Mock PortalAuthenticator for successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {},
            });

            // Mock fetchCasesByName to return an error
            mockedNameSearchPortalClient.fetchCasesByName.mockResolvedValue({
                cases: [],
                error: 'Failed to search for cases',
            });

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,
                false,
                'test-user-agent'
            );

            // Verify StorageClient.saveNameSearch was called with the failed status
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'failed',
                    message: 'Search failed: Failed to search for cases',
                })
            );

            // Verify logger.error was called with the error
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to search for cases'),
                expect.any(Error),
                expect.objectContaining({
                    userId,
                    searchId,
                    name,
                })
            );

            // Verify QueueClient.deleteMessage was called
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });

        it('should handle case where fetchCasesByName returns no cases', async () => {
            // Mock search data
            const mockNameSearch = {
                normalizedName: 'Smith, John',
                cases: [],
            };

            // Mock StorageClient to return the search data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            // Mock PortalAuthenticator for successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {},
            });

            // Mock fetchCasesByName to return no cases (empty array, no error)
            mockedNameSearchPortalClient.fetchCasesByName.mockResolvedValue({
                cases: [],
                error: undefined,
            });

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,
                false,
                'test-user-agent'
            );

            // Verify StorageClient.saveNameSearch was called with 'complete' status
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'complete',
                    cases: [],
                })
            );

            // Verify QueueClient.queueCasesForDataRetrieval was NOT called
            expect(QueueClient.queueCasesForDataRetrieval).not.toHaveBeenCalled();

            // Verify QueueClient.deleteMessage was called
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });

        it('should successfully process cases when fetchCasesByName returns cases', async () => {
            // Mock search data
            const mockNameSearch = {
                normalizedName: 'Smith, John',
                cases: [],
            };

            // Mock case data
            const mockCases = [
                { caseId: 'case-id-1', caseNumber: '23CR123456' },
                { caseId: 'case-id-2', caseNumber: '23CR654321' },
            ];

            // Mock StorageClient to return the search data
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            // Mock PortalAuthenticator for successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {},
            });

            // Mock fetchCasesByName to return cases
            mockedNameSearchPortalClient.fetchCasesByName.mockResolvedValue({
                cases: mockCases,
                error: undefined,
            });

            // Mock QueueClient.queueCasesForDataRetrieval
            (QueueClient.queueCasesForDataRetrieval as jest.Mock).mockResolvedValue(undefined);

            const searchId = 'test-search-id';
            const name = 'John Smith';
            const userId = 'test-user-id';
            const receiptHandle = 'test-receipt-handle';

            await processNameSearchRecord(
                searchId,
                name,
                userId,
                receiptHandle,
                mockLogger,
                undefined,
                false,
                'test-user-agent'
            );

            // Extract case numbers
            const caseNumbers = mockCases.map(caseItem => caseItem.caseNumber);

            // Verify StorageClient.saveNameSearch was called with 'complete' status and cases
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                searchId,
                expect.objectContaining({
                    ...mockNameSearch,
                    status: 'complete',
                    cases: caseNumbers,
                })
            );

            // Verify QueueClient.queueCasesForDataRetrieval was called with cases
            expect(QueueClient.queueCasesForDataRetrieval).toHaveBeenCalledWith(userId, mockCases);

            // Verify QueueClient.deleteMessage was called
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(receiptHandle, 'search');
        });
    });
});
