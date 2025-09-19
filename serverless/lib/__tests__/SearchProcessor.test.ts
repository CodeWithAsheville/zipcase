/**
 * Tests for the unified SearchProcessor module
 */
import { processSearch } from '../SearchProcessor';
import AlertService from '../AlertService';
import { SQSEvent, SQSRecord, Context } from 'aws-lambda';

// Import the processor implementations so we can mock them
import * as CaseSearchProcessor from '../CaseSearchProcessor';
import * as NameSearchProcessor from '../NameSearchProcessor';

// Mock the processors
jest.mock('../CaseSearchProcessor');
jest.mock('../NameSearchProcessor');
jest.mock('../AlertService');

describe('SearchProcessor', () => {
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

    beforeEach(() => {
        jest.clearAllMocks();

        // Default AlertService mock
        const mockAlertServiceInstance = {
            error: jest.fn().mockResolvedValue(undefined),
            warn: jest.fn().mockResolvedValue(undefined),
            info: jest.fn().mockResolvedValue(undefined),
            critical: jest.fn().mockResolvedValue(undefined),
        };
        (AlertService.forCategory as jest.Mock).mockReturnValue(mockAlertServiceInstance);
    });

    describe('processSearch SQS handler', () => {
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
                        timestamp: Date.now(),
                    }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '123456789',
                        SenderId: 'sender-id',
                        ApproximateFirstReceiveTimestamp: '123456789',
                    },
                    messageAttributes: {},
                    md5OfBody: 'test-md5',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:region:account:queue',
                    awsRegion: 'us-east-1',
                } as SQSRecord,
            ],
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
                        timestamp: Date.now(),
                    }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '123456789',
                        SenderId: 'sender-id',
                        ApproximateFirstReceiveTimestamp: '123456789',
                    },
                    messageAttributes: {},
                    md5OfBody: 'test-md5',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:region:account:queue',
                    awsRegion: 'us-east-1',
                } as SQSRecord,
            ],
        });

        beforeEach(() => {
            // Mock the processor implementations
            (CaseSearchProcessor.processCaseSearchRecord as jest.Mock).mockResolvedValue(undefined);
            (NameSearchProcessor.processNameSearchRecord as jest.Mock).mockResolvedValue(undefined);
        });

        it('should process a case search message through the appropriate processor', async () => {
            const event = createSQSCaseSearchEvent('123', 'user1');

            await processSearch(event, mockContext, () => {});

            expect(CaseSearchProcessor.processCaseSearchRecord).toHaveBeenCalledWith(
                '123',
                'user1',
                'test-receipt-handle',
                expect.anything(), // logger
                'test-agent'
            );
        });

        it('should process a name search message through the appropriate processor', async () => {
            const event = createSQSNameSearchEvent('search1', 'John Doe', 'user1');

            await processSearch(event, mockContext, () => {});

            expect(NameSearchProcessor.processNameSearchRecord).toHaveBeenCalledWith(
                'search1',
                'John Doe',
                'user1',
                'test-receipt-handle',
                expect.anything(), // logger
                undefined, // dateOfBirth
                false, // soundsLike
                'test-agent'
            );
        });

        it('should log error for unknown message type', async () => {
            const event: SQSEvent = {
                Records: [
                    {
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            unknownField: 'test',
                            userId: 'user1',
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '123456789',
                            SenderId: 'sender-id',
                            ApproximateFirstReceiveTimestamp: '123456789',
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:region:account:queue',
                        awsRegion: 'us-east-1',
                    } as SQSRecord,
                ],
            };

            await processSearch(event, mockContext, () => {});

            // Verify logger error was called
            const mockAlertServiceInstance = (AlertService.forCategory as jest.Mock).mock.results[0].value;
            expect(mockAlertServiceInstance.error).toHaveBeenCalled();
        });
    });
});
