/**
 * Tests for the QueueClient module
 */
import QueueClient from '../QueueClient';
import {
    SendMessageCommand,
    SendMessageBatchCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
    return {
        SQSClient: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockImplementation(command => {
                if (command instanceof SendMessageCommand) {
                    return Promise.resolve({ MessageId: 'test-message-id' });
                } else if (command instanceof SendMessageBatchCommand) {
                    return Promise.resolve({
                        Successful: [{ Id: '0', MessageId: 'test-batch-id-1' }],
                        Failed: [],
                    });
                } else if (command instanceof DeleteMessageCommand) {
                    return Promise.resolve({});
                }
                return Promise.resolve({});
            }),
        })),
        SendMessageCommand: jest.fn().mockImplementation(params => {
            return { params };
        }),
        SendMessageBatchCommand: jest.fn().mockImplementation(params => {
            return { params };
        }),
        DeleteMessageCommand: jest.fn().mockImplementation(params => {
            return { params };
        }),
    };
});

// Set environment variables for testing
process.env.CASE_SEARCH_QUEUE_URL = 'https://sqs.example.com/search-queue';
process.env.CASE_DATA_QUEUE_URL = 'https://sqs.example.com/data-queue';

describe('QueueClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('queueCaseForSearch', () => {
        it('should send a message to the search queue with the case number and user ID', async () => {
            const caseNumber = '22CR123456-789';
            const userId = 'test-user';

            await QueueClient.queueCaseForSearch(caseNumber, userId);

            expect(SendMessageCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    QueueUrl: 'https://sqs.example.com/search-queue',
                    MessageBody: expect.stringContaining(caseNumber),
                    MessageGroupId: userId,
                })
            );
        });
    });

    describe('queueCaseForDataRetrieval', () => {
        it('should send a message to the data queue with the case number, case ID and user ID', async () => {
            const caseNumber = '22CR123456-789';
            const caseId = 'case-123';
            const userId = 'test-user';

            await QueueClient.queueCaseForDataRetrieval(caseNumber, caseId, userId);

            expect(SendMessageCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    QueueUrl: 'https://sqs.example.com/data-queue',
                    MessageBody: expect.stringContaining(caseNumber),
                    MessageDeduplicationId: caseNumber.toUpperCase(), // We use normalized (uppercase) case number for deduplication
                    MessageGroupId: caseId, // We use caseId as the group ID
                })
            );
        });
    });

    describe('queueCasesForSearch', () => {
        it('should do nothing for empty cases array', async () => {
            await QueueClient.queueCasesForSearch([], 'test-user');

            expect(SendMessageBatchCommand).not.toHaveBeenCalled();
        });

        it('should send batch messages for multiple cases', async () => {
            const cases = ['22CR123456-789', '23CV654321-456'];
            const userId = 'test-user';

            await QueueClient.queueCasesForSearch(cases, userId);

            expect(SendMessageBatchCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    QueueUrl: 'https://sqs.example.com/search-queue',
                    Entries: expect.arrayContaining([
                        expect.objectContaining({
                            MessageBody: expect.stringContaining(cases[0]),
                            MessageGroupId: userId,
                        }),
                        expect.objectContaining({
                            MessageBody: expect.stringContaining(cases[1]),
                            MessageGroupId: userId,
                        }),
                    ]),
                })
            );
        });

        it('should handle batches of more than 10 items', async () => {
            // Create an array of 15 case numbers
            const cases = Array.from(
                { length: 15 },
                (_, i) => `22CR${(100000 + i).toString()}-789`
            );
            const userId = 'test-user';

            await QueueClient.queueCasesForSearch(cases, userId);

            // Should have been called twice for batches of 10 and 5
            expect(SendMessageBatchCommand).toHaveBeenCalledTimes(2);
        });
    });

    describe('deleteMessage', () => {
        it('should send a delete message command for search queue', async () => {
            const receiptHandle = 'test-receipt-handle';

            await QueueClient.deleteMessage(receiptHandle, 'search');

            expect(DeleteMessageCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    QueueUrl: 'https://sqs.example.com/search-queue',
                    ReceiptHandle: receiptHandle,
                })
            );
        });

        it('should send a delete message command for data queue', async () => {
            const receiptHandle = 'test-receipt-handle';

            await QueueClient.deleteMessage(receiptHandle, 'data');

            expect(DeleteMessageCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    QueueUrl: 'https://sqs.example.com/data-queue',
                    ReceiptHandle: receiptHandle,
                })
            );
        });
    });
});
