import { SQSHandler, SQSEvent } from 'aws-lambda';
import AlertService, { AlertCategory } from './AlertService';
import { processCaseSearchRecord } from './CaseSearchProcessor';
import { processNameSearchRecord } from './NameSearchProcessor';

// Define union types for discriminating between search message types
export interface CaseSearchMessage {
    messageType: 'case';
    caseNumber: string;
    userId: string;
    userAgent?: string;
    timestamp: number;
}

export interface NameSearchMessage {
    messageType: 'name';
    searchId: string;
    name: string;
    userId: string;
    dateOfBirth?: string;
    soundsLike?: boolean;
    userAgent?: string;
    timestamp: number;
}

// Union type for all search messages - used mainly for type checking
export type SearchMessage = CaseSearchMessage | NameSearchMessage;

// Unified search queue processor handler
export const processSearch: SQSHandler = async (event: SQSEvent) => {
    console.log(`Received ${event.Records.length} search messages to process`);

    // Create specialized logger for search processing
    const searchLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);

            // Determine message type based on payload attributes
            if (messageBody.caseNumber && !messageBody.searchId) {
                // This is a case search message
                await processCaseSearchRecord(
                    messageBody.caseNumber,
                    messageBody.userId,
                    record.receiptHandle,
                    searchLogger,
                    messageBody.userAgent
                );
            } else if (messageBody.searchId && messageBody.name) {
                // This is a name search message
                await processNameSearchRecord(
                    messageBody.searchId,
                    messageBody.name,
                    messageBody.userId,
                    record.receiptHandle,
                    searchLogger,
                    messageBody.dateOfBirth,
                    messageBody.soundsLike,
                    messageBody.userAgent
                );
            } else {
                // Unknown message type
                await searchLogger.error(
                    'Invalid message format, cannot determine search type',
                    undefined,
                    { messageId: record.messageId, payload: JSON.stringify(messageBody) }
                );
            }
        } catch (error) {
            await searchLogger.error('Failed to process search record', error as Error, {
                messageId: record.messageId,
            });
        }
    }
};