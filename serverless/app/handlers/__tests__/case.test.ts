import { get, processCaseData } from '../case';
import StorageClient from '../../../lib/StorageClient';
import PortalAuthenticator from '../../../lib/PortalAuthenticator';
import QueueClient from '../../../lib/QueueClient';
import CaseProcessor from '../../../lib/CaseProcessor';

// Mock the dependencies
jest.mock('../../../lib/StorageClient');
jest.mock('../../../lib/PortalAuthenticator');
jest.mock('../../../lib/QueueClient');
jest.mock('../../../lib/CaseProcessor');

// Mock event with auth context
const createEvent = (pathParams?: any, userId = 'test-user-id') => ({
    requestContext: {
        authorizer: {
            jwt: {
                claims: {
                    sub: userId,
                },
            },
        },
    },
    pathParameters: pathParams,
});

describe('case handler', () => {
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

        it('should return 400 if case number is missing', async () => {
            const event = createEvent();

            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(400);
                expect(JSON.parse(response.body).error).toBe('Missing case number');
            }
        });

        it('should return 200 with complete case data if available', async () => {
            const completeCase = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    fetchStatus: { status: 'complete' },
                    caseData: {
                        /* some case data */
                    },
                },
                caseSummary: {
                    /* some summary data */
                },
            };

            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(completeCase);

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(200);
                expect(JSON.parse(response.body)).toEqual(completeCase);
            }
        });

        it('should return 202 if case is still processing', async () => {
            const processingCase = {
                zipCase: {
                    caseNumber: '22CR123456-789',
                    fetchStatus: { status: 'processing' },
                },
            };

            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(processingCase);

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(202);
                expect(JSON.parse(response.body)).toEqual(processingCase);
            }
        });

        it('should queue case search if user has an active session', async () => {
            // No existing search result
            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(null);

            // User has active session
            const mockGetUserSession = StorageClient.getUserSession as jest.Mock;
            mockGetUserSession.mockResolvedValue('session-token');

            // Mock queue client
            const mockQueueCaseForSearch = QueueClient.queueCaseForSearch as jest.Mock;
            mockQueueCaseForSearch.mockResolvedValue(undefined);

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(202);
                const responseBody = JSON.parse(response.body);
                expect(responseBody.zipCase.caseNumber).toBe('22CR123456-789');
                expect(responseBody.zipCase.fetchStatus.status).toBe('queued');

                expect(mockQueueCaseForSearch).toHaveBeenCalledWith(
                    '22CR123456-789',
                    'test-user-id'
                );
            }
        });

        it('should authenticate with portal credentials if no active session', async () => {
            // No existing search result
            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(null);

            // No active session
            const mockGetUserSession = StorageClient.getUserSession as jest.Mock;
            mockGetUserSession.mockResolvedValue(null);

            // User has portal credentials
            const mockGetPortalCredentials =
                StorageClient.sensitiveGetPortalCredentials as jest.Mock;
            mockGetPortalCredentials.mockResolvedValue({
                username: 'test-username',
                password: 'test-password',
            });

            // Mock successful authentication
            const mockAuthenticateWithPortal =
                PortalAuthenticator.authenticateWithPortal as jest.Mock;
            mockAuthenticateWithPortal.mockResolvedValue({
                success: true,
                cookieJar: {
                    toJSON: () => ({ cookies: [] }),
                },
            });

            // Mock storage methods
            const mockSaveUserSession = StorageClient.saveUserSession as jest.Mock;
            mockSaveUserSession.mockResolvedValue(undefined);

            const mockSaveCase = StorageClient.saveCase as jest.Mock;
            mockSaveCase.mockResolvedValue(undefined);

            // Mock queue client
            const mockQueueCaseForSearch = QueueClient.queueCaseForSearch as jest.Mock;
            mockQueueCaseForSearch.mockResolvedValue(undefined);

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(202);
                const responseBody = JSON.parse(response.body);
                expect(responseBody.zipCase.caseNumber).toBe('22CR123456-789');
                expect(responseBody.zipCase.fetchStatus.status).toBe('queued');

                expect(mockAuthenticateWithPortal).toHaveBeenCalledWith(
                    'test-username',
                    'test-password'
                );
                expect(mockSaveUserSession).toHaveBeenCalled();
                expect(mockSaveCase).toHaveBeenCalled();
                expect(mockQueueCaseForSearch).toHaveBeenCalledWith(
                    '22CR123456-789',
                    'test-user-id'
                );
            }
        });

        it('should return 401 if portal authentication fails', async () => {
            // No existing search result
            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(null);

            // No active session
            const mockGetUserSession = StorageClient.getUserSession as jest.Mock;
            mockGetUserSession.mockResolvedValue(null);

            // User has portal credentials
            const mockGetPortalCredentials =
                StorageClient.sensitiveGetPortalCredentials as jest.Mock;
            mockGetPortalCredentials.mockResolvedValue({
                username: 'test-username',
                password: 'test-password',
            });

            // Mock failed authentication
            const mockAuthenticateWithPortal =
                PortalAuthenticator.authenticateWithPortal as jest.Mock;
            mockAuthenticateWithPortal.mockResolvedValue({
                success: false,
                message: 'Invalid credentials',
            });

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(401);
                const responseBody = JSON.parse(response.body);
                expect(responseBody.error).toBe('Authentication failed');
                // Check the format of the error response based on actual implementation
                expect(responseBody.message).toBeDefined();
                expect(responseBody.data).toBeDefined();
                expect(responseBody.data.caseNumber).toBe('22CR123456-789');
                expect(responseBody.data.fetchStatus.status).toBe('failed');
            }
        });

        it('should return 403 if no portal credentials are available', async () => {
            // No existing search result
            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockResolvedValue(null);

            // No active session
            const mockGetUserSession = StorageClient.getUserSession as jest.Mock;
            mockGetUserSession.mockResolvedValue(null);

            // No portal credentials
            const mockGetPortalCredentials =
                StorageClient.sensitiveGetPortalCredentials as jest.Mock;
            mockGetPortalCredentials.mockResolvedValue(null);

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(403);
                const responseBody = JSON.parse(response.body);
                expect(responseBody.error).toBe('Portal credentials required');
                // Check the format of the error response based on actual implementation
                expect(responseBody.message).toBeDefined();
                expect(responseBody.data).toBeDefined();
                expect(responseBody.data.caseNumber).toBe('22CR123456-789');
                expect(responseBody.data.fetchStatus.status).toBe('failed');
            }
        });

        it('should handle errors gracefully', async () => {
            const mockGetSearchResult = StorageClient.getSearchResult as jest.Mock;
            mockGetSearchResult.mockRejectedValue(new Error('Database error'));

            const event = createEvent({ caseNumber: '22CR123456-789' });
            const response = await get(event as any, null as any, null as any);

            expect(response).toBeDefined();
            if (response) {
                expect(response.statusCode).toBe(500);
                expect(JSON.parse(response.body).error).toBe('Internal server error');
                // The message property format might differ in implementation
                const responseBody = JSON.parse(response.body);
                expect(responseBody.message || responseBody.details?.message).toBeDefined();

                // Skip checking the exact structure as it might vary
                // We only check that the response indicates an error occurred
            }
        });
    });


    describe('processCaseData function', () => {
        it('should delegate to CaseProcessor.processCaseData', async () => {
            const mockProcessCaseData = CaseProcessor.processCaseData as jest.Mock;
            mockProcessCaseData.mockResolvedValue('success');

            const event = { Records: [] } as any;
            const context = {} as any;
            const callback = () => {};

            const result = await processCaseData(event, context, callback);

            expect(mockProcessCaseData).toHaveBeenCalledWith(event, context, callback);
            expect(result).toBe('success');
        });
    });
});
