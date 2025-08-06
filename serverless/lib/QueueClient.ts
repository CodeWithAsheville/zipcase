import {
    SQSClient,
    SendMessageCommand,
    SendMessageBatchCommand,
    DeleteMessageCommand,
    SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import AlertService, { Severity, AlertCategory } from './AlertService';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });

const QueueClient = {
    // Queue a case for the search process (finding caseId)
    async queueCaseForSearch(
        caseNumber: string,
        userId: string,
        userAgent?: string
    ): Promise<void> {
        const normalizedCaseNumber = caseNumber.toUpperCase();
        const params = {
            QueueUrl: process.env.SEARCH_QUEUE_URL!,
            MessageBody: JSON.stringify({
                caseNumber,
                userId,
                userAgent,
                timestamp: Date.now(),
            }),
            MessageGroupId: userId, // Group by userId to process requests serially per user
            MessageDeduplicationId: normalizedCaseNumber,
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
        } catch (error) {
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.QUEUE,
                'Failed to queue case for search',
                error as Error,
                { caseNumber, userId }
            );
            throw error;
        }
    },

    async queueNameSearch(
        searchId: string,
        name: string,
        userId: string,
        dateOfBirth?: string,
        soundsLike = false,
        criminalOnly = true,
        userAgent?: string
    ): Promise<void> {
        const params: SendMessageCommandInput = {
            QueueUrl: process.env.SEARCH_QUEUE_URL!,
            MessageBody: JSON.stringify({
                searchId,
                name,
                dateOfBirth,
                soundsLike,
                userId,
                userAgent,
                criminalOnly,
                timestamp: Date.now(),
            }),
            MessageGroupId: userId, // Group by userId to process requests serially per user
            MessageDeduplicationId: searchId, // Use existing searchId for deduplication
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
        } catch (error) {
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.QUEUE,
                'Failed to queue name search for processing',
                error as Error,
                { searchId, userId, name }
            );
            throw error;
        }
    },

    async queueCasesForDataRetrieval(
        userId: string,
        cases: { caseNumber: string; caseId: string }[]
    ): Promise<void> {
        if (!cases || cases.length === 0) {
            return;
        }

        const timestamp = Date.now();

        // SQS batch operations are limited to 10 messages per request
        const BATCH_SIZE = 10;

        // Process in batches of 10
        for (let i = 0; i < cases.length; i += BATCH_SIZE) {
            const batch = cases.slice(i, i + BATCH_SIZE);

            const entries = batch.map(({ caseNumber, caseId }, index) => {
                const normalizedCaseNumber = caseNumber.toUpperCase();
                return {
                    Id: `${index}`, // Unique ID within the batch request
                    MessageBody: JSON.stringify({
                        caseNumber,
                        caseId,
                        userId,
                        timestamp,
                    }),
                    MessageGroupId: caseId, // Group by caseId
                    MessageDeduplicationId: normalizedCaseNumber,
                };
            });

            try {
                const command = new SendMessageBatchCommand({
                    QueueUrl: process.env.CASE_DATA_QUEUE_URL!,
                    Entries: entries,
                });

                const response = await sqsClient.send(command);

                // Check for failed messages
                if (response.Failed && response.Failed.length > 0) {
                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.QUEUE,
                        `Failed to queue ${response.Failed.length} cases for data retrieval`,
                        new Error(JSON.stringify(response.Failed)),
                        {
                            userId,
                            batchSize: batch.length,
                            failedCount: response.Failed.length,
                        }
                    );
                    throw new Error(`Failed to queue ${response.Failed.length} cases for data retrieval`);
                }
            } catch (error) {
                await AlertService.logError(
                    Severity.ERROR,
                    AlertCategory.QUEUE,
                    'Error in batch queuing cases for data retrieval',
                    error as Error,
                    {
                        userId,
                        casesCount: cases.length,
                        batchIndex: Math.floor(i / BATCH_SIZE),
                    }
                );
                throw error;
            }
        }
    },

    // Queue a case for data retrieval (after caseId is found)
    async queueCaseForDataRetrieval(
        caseNumber: string,
        caseId: string,
        userId: string
    ): Promise<void> {
        const normalizedCaseNumber = caseNumber.toUpperCase();
        const params = {
            QueueUrl: process.env.CASE_DATA_QUEUE_URL!,
            MessageBody: JSON.stringify({
                caseNumber,
                caseId,
                userId,
                timestamp: Date.now(),
            }),
            MessageGroupId: caseId, // Group by caseId
            // Use normalized case number for deduplication to prevent duplicate processing
            MessageDeduplicationId: normalizedCaseNumber,
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
        } catch (error) {
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.QUEUE,
                'Failed to queue case for data retrieval',
                error as Error,
                { caseNumber, caseId, userId }
            );
            throw error;
        }
    },

    async queueCasesForSearch(cases: string[], userId: string, userAgent?: string): Promise<void> {
        if (!cases || cases.length === 0) {
            return;
        }

        const timestamp = Date.now();

        // SQS batch operations are limited to 10 messages per request
        const BATCH_SIZE = 10;

        // Process in batches of 10
        for (let i = 0; i < cases.length; i += BATCH_SIZE) {
            const batch = cases.slice(i, i + BATCH_SIZE);

            const entries = batch.map((caseNumber, index) => {
                const normalizedCaseNumber = caseNumber.toUpperCase();
                return {
                    Id: `${index}`, // Unique ID within the batch request
                    MessageBody: JSON.stringify({
                        caseNumber,
                        userId,
                        userAgent,
                        timestamp,
                    }),
                    MessageGroupId: userId, // Group by userId to process requests serially per user
                    MessageDeduplicationId: normalizedCaseNumber,
                };
            });

            try {
                const command = new SendMessageBatchCommand({
                    QueueUrl: process.env.SEARCH_QUEUE_URL!,
                    Entries: entries,
                });

                const response = await sqsClient.send(command);

                // Check for failed messages
                if (response.Failed && response.Failed.length > 0) {
                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.QUEUE,
                        `Failed to queue ${response.Failed.length} cases`,
                        new Error(JSON.stringify(response.Failed)),
                        {
                            userId,
                            batchSize: batch.length,
                            failedCount: response.Failed.length,
                        }
                    );
                    throw new Error(`Failed to queue ${response.Failed.length} cases`);
                }
            } catch (error) {
                await AlertService.logError(
                    Severity.ERROR,
                    AlertCategory.QUEUE,
                    'Error in batch queuing cases for search',
                    error as Error,
                    {
                        userId,
                        casesCount: cases.length,
                        batchIndex: Math.floor(i / BATCH_SIZE),
                    }
                );
                throw error;
            }
        }
    },

    async deleteMessage(receiptHandle: string, queueType: 'search' | 'data'): Promise<void> {
        const queueUrl =
            queueType === 'search'
                ? process.env.SEARCH_QUEUE_URL!
                : process.env.CASE_DATA_QUEUE_URL!;

        try {
            const command = new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: receiptHandle,
            });

            await sqsClient.send(command);
        } catch (error) {
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.QUEUE,
                `Failed to delete message from ${queueType} queue`,
                error as Error,
                {
                    queueType,
                    receiptHandle: receiptHandle.substring(0, 20) + '...', // Truncate for readability
                }
            );
            throw error;
        }
    },
};

export default QueueClient;
