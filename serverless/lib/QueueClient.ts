import {
    SQSClient,
    SendMessageCommand,
    SendMessageBatchCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });

const QueueClient = {
    // Queue a case for the search process (finding caseId)
    async queueCaseForSearch(caseNumber: string, userId: string): Promise<void> {
        const normalizedCaseNumber = caseNumber.toUpperCase();
        const params = {
            QueueUrl: process.env.SEARCH_QUEUE_URL!,
            MessageBody: JSON.stringify({
                searchType: 'case',
                caseNumber,
                userId,
                timestamp: Date.now(),
            }),
            MessageGroupId: userId, // Group by userId to process requests serially per user
            MessageDeduplicationId: normalizedCaseNumber,
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
        } catch (error) {
            console.error('Error queuing case for search:', error);
            throw error;
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
            console.error('Error queuing case for data retrieval:', error);
            throw error;
        }
    },

    async queueCasesForSearch(cases: string[], userId: string): Promise<void> {
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
                    console.error('Some messages failed to queue:', response.Failed);
                    throw new Error(`Failed to queue ${response.Failed.length} cases`);
                }
            } catch (error) {
                console.error('Error batch queuing cases for search:', error);
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
            console.error(`Error deleting message from ${queueType} queue:`, error);
            throw error;
        }
    },
};

export default QueueClient;
