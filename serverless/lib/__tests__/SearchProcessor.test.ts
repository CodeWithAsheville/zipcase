/**
 * Tests for the unified SearchProcessor module
 */
import {
    processCaseSearchRequest,
    processNameSearchRequest,
    getNameSearchResults,
    processSearch
} from '../SearchProcessor';
import StorageClient from '../StorageClient';
import SearchParser from '../SearchParser';
import QueueClient from '../QueueClient';
import PortalAuthenticator from '../PortalAuthenticator';
import AlertService from '../AlertService';
import NameParser from '../NameParser';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { CaseSearchRequest } from '../../../shared/types';
import UserAgentClient from '../UserAgentClient';

// Mock dependencies
jest.mock('../StorageClient');
jest.mock('../SearchParser');
jest.mock('../QueueClient');
jest.mock('../PortalAuthenticator');
jest.mock('../AlertService');
jest.mock('../NameParser');
jest.mock('axios');
jest.mock('cheerio');
jest.mock('tough-cookie');
jest.mock('uuid');
jest.mock('../UserAgentClient');

// Set up env variables
process.env.PORTAL_URL = 'https://test-portal.example.com';

describe('SearchProcessor', () => {
    const mockUserId = 'test-user-id';
    const mockUserAgent = 'test-user-agent';
    
    // Mock context for Lambda handlers
    const mockContext: Context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: 'test-log-group',
        logStreamName: 'test-log-stream',
        getRemainingTimeInMillis: () => 1000,
        done: () => {},
        fail: () => {},
        succeed: () => {},
    };
    
    // Common setup
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetAllMocks();
        
        // Mock common methods we don't care about testing details of
        (UserAgentClient.getUserAgent as jest.Mock).mockResolvedValue('Mozilla/5.0');
        
        // Default AlertService mock
        const mockAlertServiceInstance = {
            error: jest.fn().mockResolvedValue(undefined),
            warn: jest.fn().mockResolvedValue(undefined),
            info: jest.fn().mockResolvedValue(undefined),
            critical: jest.fn().mockResolvedValue(undefined)
        };
        (AlertService.forCategory as jest.Mock).mockReturnValue(mockAlertServiceInstance);
        (AlertService.logError as jest.Mock).mockResolvedValue(undefined);
    });

    describe('processCaseSearchRequest', () => {
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

            const req: CaseSearchRequest = {
                input: '',
                userId: mockUserId,
            };

            const result = await processCaseSearchRequest(req);

            expect(result).toEqual({ results: {} });
            expect(StorageClient.getSearchResults).not.toHaveBeenCalled();
        });

        it('should queue new cases for processing', async () => {
            const caseNumber = '22CR123456-789';
            const req: CaseSearchRequest = {
                input: caseNumber,
                userId: mockUserId,
                userAgent: mockUserAgent
            };

            const result = await processCaseSearchRequest(req);

            expect(StorageClient.saveCase).toHaveBeenCalledWith({
                caseNumber,
                fetchStatus: { status: 'queued' },
            });

            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith(
                [caseNumber],
                req.userId,
                req.userAgent
            );

            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('queued');
        });

        it('should preserve status for cases in terminal states', async () => {
            const caseNumber = '22CR123456-789';
            const req: CaseSearchRequest = {
                input: caseNumber,
                userId: mockUserId,
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

            const result = await processCaseSearchRequest(req);

            // Should not queue already complete cases
            expect(QueueClient.queueCasesForSearch).not.toHaveBeenCalled();

            // Result should include the existing case with its status preserved
            expect(result.results).toHaveProperty(caseNumber);
            expect(result.results[caseNumber].zipCase.fetchStatus.status).toBe('complete');
        });

        it('should queue data retrieval for cases with found status', async () => {
            const caseNumber = '22CR123456-789';
            const caseId = 'test-case-id';
            const req: CaseSearchRequest = {
                input: caseNumber,
                userId: mockUserId,
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

            const result = await processCaseSearchRequest(req);

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

        it('should mark cases as failed if authentication fails', async () => {
            const caseNumber = '22CR123456-789';
            const req: CaseSearchRequest = {
                input: caseNumber,
                userId: mockUserId,
            };

            // Mock failed authentication with getOrCreateUserSession
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials',
            });

            const result = await processCaseSearchRequest(req);

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
    });

    describe('processNameSearchRequest', () => {
        const mockRequest = {
            name: 'Smith, John',
            dateOfBirth: '1980-01-01',
            soundsLike: false,
            userAgent: 'test-agent'
        };

        beforeEach(() => {
            // Set up mocks
            (NameParser.parseAndStandardizeName as jest.Mock).mockImplementation(name => name);
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);
            (StorageClient.saveNameSearch as jest.Mock).mockResolvedValue(undefined);
            (QueueClient.queueNameSearch as jest.Mock).mockResolvedValue(undefined);
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: { toJSON: () => ({ cookies: [] }) }
            });
            (uuidv4 as jest.Mock).mockReturnValue('mock-uuid-1234');
        });

        it('should return error if name cannot be parsed', async () => {
            (NameParser.parseAndStandardizeName as jest.Mock).mockReturnValue('');

            const result = await processNameSearchRequest(mockRequest, mockUserId);

            expect(result).toEqual({
                searchId: 'mock-uuid-1234',
                results: {},
                success: false,
                error: expect.stringContaining('Name could not be parsed')
            });
            expect(StorageClient.saveNameSearch).toHaveBeenCalled();
            expect(QueueClient.queueNameSearch).not.toHaveBeenCalled();
        });

        it('should generate search ID and save data for valid name', async () => {
            await processNameSearchRequest(mockRequest, mockUserId);

            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                'mock-uuid-1234',
                expect.objectContaining({
                    originalName: 'Smith, John',
                    normalizedName: 'Smith, John',
                    dateOfBirth: '1980-01-01',
                    soundsLike: false,
                    cases: [],
                    status: 'queued'
                }),
                expect.any(Number)
            );
        });

        it('should queue name search if user session exists', async () => {
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: { toJSON: () => ({ cookies: [] }) }
            });

            await processNameSearchRequest(mockRequest, mockUserId);

            expect(QueueClient.queueNameSearch).toHaveBeenCalledWith(
                'mock-uuid-1234',
                'Smith, John',
                mockUserId,
                '1980-01-01',
                false,
                'test-agent'
            );
        });

        it('should handle authentication failure', async () => {
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                dateOfBirth: '1980-01-01',
                soundsLike: false,
                cases: []
            };

            // Mock getOrCreateUserSession to fail
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials'
            });

            // Mock the name search retrieval for the error handling
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);

            const result = await processNameSearchRequest(mockRequest, mockUserId);

            // Verify the name search was saved with failed status
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                'mock-uuid-1234',
                expect.objectContaining({
                    status: 'failed'
                }),
                expect.any(Number)
            );

            // Verify the response contains the error
            expect(result).toEqual({
                searchId: 'mock-uuid-1234',
                results: {},
                success: false,
                error: 'Invalid credentials'
            });

            // Queue should not be called
            expect(QueueClient.queueNameSearch).not.toHaveBeenCalled();
        });
    });

    describe('getNameSearchResults', () => {
        const mockSearchId = 'search-123';

        it('should return empty results if name search does not exist', async () => {
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: {}
            });
            expect(StorageClient.getSearchResults).not.toHaveBeenCalled();
        });

        it('should fetch and return results for existing name search', async () => {
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                cases: ['123', '456'],
                status: 'complete'
            };
            const mockSearchResults = {
                '123': { zipCase: { caseNumber: '123' } },
                '456': { zipCase: { caseNumber: '456' } }
            };

            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue(mockSearchResults);

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: mockSearchResults,
                success: true
            });
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith(['123', '456']);
        });

        it('should include error in result for failed searches', async () => {
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                cases: [],
                status: 'failed',
                message: 'Search failed due to network error'
            };

            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue({});

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: {},
                success: false,
                error: 'Search failed due to network error'
            });
        });
    });

    describe('processSearch (SQS Handler)', () => {
        // Mock SQS event creation helper
        const createSQSCaseSearchEvent = (
            caseNumber: string,
            userId: string,
            userAgent = 'test-agent',
            receiptHandle = 'test-receipt-handle'
        ): SQSEvent => ({
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle,
                    body: JSON.stringify({
                        caseNumber,
                        userId,
                        userAgent,
                        timestamp: Date.now()
                    }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '123456789',
                        SenderId: 'sender-id',
                        ApproximateFirstReceiveTimestamp: '123456789'
                    },
                    messageAttributes: {},
                    md5OfBody: 'test-md5',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:region:account:queue',
                    awsRegion: 'us-east-1'
                } as SQSRecord
            ]
        });

        const createSQSNameSearchEvent = (
            searchId: string,
            name: string,
            userId: string,
            dateOfBirth?: string,
            soundsLike = false,
            userAgent = 'test-agent',
            receiptHandle = 'test-receipt-handle'
        ): SQSEvent => ({
            Records: [
                {
                    messageId: 'test-message-id',
                    receiptHandle,
                    body: JSON.stringify({
                        searchId,
                        name,
                        userId,
                        dateOfBirth,
                        soundsLike,
                        userAgent,
                        timestamp: Date.now()
                    }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '123456789',
                        SenderId: 'sender-id',
                        ApproximateFirstReceiveTimestamp: '123456789'
                    },
                    messageAttributes: {},
                    md5OfBody: 'test-md5',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:region:account:queue',
                    awsRegion: 'us-east-1'
                } as SQSRecord
            ]
        });

        beforeEach(() => {
            // Set up mocks for processCaseSearchRecord functionality
            (StorageClient.getCase as jest.Mock).mockResolvedValue(null);
            (StorageClient.saveCase as jest.Mock).mockResolvedValue(undefined);
            (QueueClient.deleteMessage as jest.Mock).mockResolvedValue(undefined);
            (QueueClient.queueCaseForDataRetrieval as jest.Mock).mockResolvedValue(undefined);
            
            // Set up mocks for processNameSearchRecord functionality
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue({
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                cases: [],
                status: 'queued'
            });
            (StorageClient.saveNameSearch as jest.Mock).mockResolvedValue(undefined);
            (QueueClient.queueCasesForSearch as jest.Mock).mockResolvedValue(undefined);

            // Mock successful authentication
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: new CookieJar()
            });
            
            // Mock cheerio loading
            (cheerio.load as jest.Mock).mockImplementation(() => {
                return function() {
                    return {
                        length: 1,
                        each: jest.fn((callback) => {
                            callback(0, { 
                                find: () => ({ 
                                    length: 1, 
                                    text: () => '123-456-789' 
                                }) 
                            });
                        }),
                        find: jest.fn().mockReturnThis(),
                        first: jest.fn().mockReturnThis(),
                        attr: jest.fn().mockReturnValue('test-case-id'),
                        text: jest.fn().mockReturnValue('test-case-number')
                    };
                };
            });
            
            // Mock axios wrapper
            const mockAxios = {
                post: jest.fn().mockResolvedValue({ status: 200, data: '<html></html>' }),
                get: jest.fn().mockResolvedValue({ status: 200, data: '<html></html>' })
            };
            jest.spyOn(axios, 'create').mockImplementation(() => mockAxios as any);
        });

        it('should process a case search message', async () => {
            const caseNumber = '22CR123456-789';
            const event = createSQSCaseSearchEvent(caseNumber, mockUserId);
            
            // Set up case search to succeed
            await processSearch(event, mockContext, () => {});
            
            // Verify authentication was attempted
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                mockUserId,
                'test-agent'
            );
            
            // Verify case status was saved
            expect(StorageClient.saveCase).toHaveBeenCalled();
            
            // Verify the message was deleted from the queue
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(
                'test-receipt-handle',
                'search'
            );
        });

        it('should process a name search message', async () => {
            const searchId = 'test-search-id';
            const name = 'Smith, John';
            const event = createSQSNameSearchEvent(searchId, name, mockUserId);
            
            await processSearch(event, mockContext, () => {});
            
            // Verify authentication was attempted
            expect(PortalAuthenticator.getOrCreateUserSession).toHaveBeenCalledWith(
                mockUserId, 
                'test-agent'
            );
            
            // Verify name search status was updated
            expect(StorageClient.saveNameSearch).toHaveBeenCalled();
            
            // Verify the message was deleted from the queue
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(
                'test-receipt-handle',
                'search'
            );
        });

        it('should handle authentication failure for case search', async () => {
            const caseNumber = '22CR123456-789';
            const event = createSQSCaseSearchEvent(caseNumber, mockUserId);
            
            // Mock authentication failure
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials'
            });
            
            await processSearch(event, mockContext, () => {});
            
            // Verify case status was updated to failed
            expect(StorageClient.saveCase).toHaveBeenCalledWith(
                {
                    caseId: undefined,
                    caseNumber,
                    fetchStatus: {
                        status: 'failed',
                        message: 'Invalid credentials'
                    },
                    lastUpdated: expect.any(String)
                }
            );
            
            // Verify message was deleted from the queue
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(
                'test-receipt-handle', 
                'search'
            );
        });

        it('should handle authentication failure for name search', async () => {
            const searchId = 'test-search-id';
            const name = 'Smith, John';
            const event = createSQSNameSearchEvent(searchId, name, mockUserId);
            
            // Mock authentication failure
            (PortalAuthenticator.getOrCreateUserSession as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials'
            });
            
            await processSearch(event, mockContext, () => {});
            
            // Verify name search status was eventually updated to failed
            // Since we can't easily check the exact parameters of all calls, let's check that
            // saveNameSearch was called at least once and that it was last called with status 'failed'
            expect(StorageClient.saveNameSearch).toHaveBeenCalled();
            const lastCallArgs = (StorageClient.saveNameSearch as jest.Mock).mock.calls.slice(-1)[0];
            expect(lastCallArgs[0]).toBe(searchId);
            expect(lastCallArgs[1].status).toBe('failed');
            expect(lastCallArgs[1].message).toBe('Authentication failed: Invalid credentials');
            
            // Verify message was deleted from the queue
            expect(QueueClient.deleteMessage).toHaveBeenCalledWith(
                'test-receipt-handle',
                'search'
            );
        });

        it('should handle unknown message type', async () => {
            // Create a malformed message with no recognizable type indicators
            const event: SQSEvent = {
                Records: [
                    {
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            unknownField: 'test',
                            userId: mockUserId
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '123456789',
                            SenderId: 'sender-id',
                            ApproximateFirstReceiveTimestamp: '123456789'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:region:account:queue',
                        awsRegion: 'us-east-1'
                    } as SQSRecord
                ]
            };
            
            await processSearch(event, mockContext, () => {});
            
            // Verify error was logged through alert service
            const mockAlertServiceInstance = (AlertService.forCategory as jest.Mock).mock.results[0].value;
            expect(mockAlertServiceInstance.error).toHaveBeenCalled();
        });
    });
});