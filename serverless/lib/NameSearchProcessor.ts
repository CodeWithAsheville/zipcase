import { v4 as uuidv4 } from 'uuid';
import { NameSearchResponse, NameSearchData } from '../../shared/types';
import StorageClient from './StorageClient';
import NameParser from './NameParser';
import QueueClient from './QueueClient';
import PortalAuthenticator from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { fetchCasesByName } from './NameSearchPortalClient';

// Process API name search requests - creates an entry in DynamoDB and queues for processing
export async function processNameSearchRequest(
    req: { name: string; dateOfBirth?: string; soundsLike: boolean; userAgent?: string },
    userId: string
): Promise<NameSearchResponse> {
    const searchId = uuidv4();

    let success = true;
    let error: string | undefined;

    try {
        const normalizedName = NameParser.parseAndStandardizeName(req.name);
        if (!normalizedName) {
            success = false;
            error = `Name could not be parsed from input [${req.name}]`;
        }

        let userSession = null;
        if (success) {
            userSession = await PortalAuthenticator.getOrCreateUserSession(userId, req.userAgent);
            if (!userSession.success) {
                success = false;
                error = userSession.message;
            }
        }

        // Store the search data in DynamoDB with TTL of 24 hours
        const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours from now

        const nameSearchData: NameSearchData = {
            originalName: req.name,
            normalizedName,
            dateOfBirth: req.dateOfBirth,
            soundsLike: req.soundsLike,
            cases: [],
            status: success ? 'queued' : 'failed',
        };

        await StorageClient.saveNameSearch(searchId, nameSearchData, expiresAt);

        if (!success) {
            console.log(
                `Could not process name search with input [${req.name}] (ID [${searchId}]) for user [${userId}]: ${error}`
            );

            return {
                searchId,
                results: {},
                success,
                error,
            };
        }

        // Queue the name search for processing
        console.log(`Queueing name search ${searchId} for processing with existing session`);
        await QueueClient.queueNameSearch(
            searchId,
            normalizedName,
            userId,
            req.dateOfBirth,
            req.soundsLike,
            req.userAgent
        );

        return {
            searchId,
            results: {},
            success: true,
        };
    } catch (error) {
        const errorMsg = 'Error processing name search request';
        console.error(errorMsg, error);

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.PORTAL,
            errorMsg,
            error instanceof Error ? error : new Error(String(error)),
            { userId, searchId }
        );

        const existingSearch = await StorageClient.getNameSearch(searchId);
        if (existingSearch) {
            await StorageClient.saveNameSearch(searchId, {
                ...existingSearch,
                status: 'failed',
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        return {
            searchId: searchId,
            results: {},
            success: false,
            error: 'Internal error processing name search',
        };
    }
}

export async function getNameSearchResults(searchId: string): Promise<NameSearchResponse> {
    try {
        // Get the name search data from DynamoDB
        const nameSearchData = await StorageClient.getNameSearch(searchId);

        if (!nameSearchData) {
            return {
                searchId,
                results: {},
            };
        }

        // Get all cases associated with this search
        const caseNumbers = nameSearchData.cases || [];

        // Get search results for all cases
        const results = await StorageClient.getSearchResults(caseNumbers);

        return {
            searchId,
            results,
            success: nameSearchData.status !== 'failed',
            error: nameSearchData.status === 'failed' ? nameSearchData.message : undefined,
        };
    } catch (error) {
        console.error('Error getting name search results:', error);
        return {
            searchId,
            results: {},
            success: false,
            error: 'Error retrieving name search results',
        };
    }
}

// Process a name search SQS message
export async function processNameSearchRecord(
    searchId: string,
    name: string,
    userId: string,
    receiptHandle: string,
    logger: ReturnType<typeof AlertService.forCategory>,
    dateOfBirth?: string,
    soundsLike: boolean = false,
    userAgent?: string
): Promise<void> {
    console.log(`Processing name search ${searchId} for user ${userId}`);

    try {
        // Update status to processing
        const nameSearch = await StorageClient.getNameSearch(searchId);
        if (!nameSearch) {
            console.error(`Name search ${searchId} not found`);
            await QueueClient.deleteMessage(receiptHandle, 'search');
            return;
        }

        await StorageClient.saveNameSearch(searchId, {
            ...nameSearch,
            status: 'processing',
        });

        // Authenticate with the portal
        const authResult = await PortalAuthenticator.getOrCreateUserSession(userId, userAgent);

        if (!authResult?.success || !authResult.cookieJar) {
            const message = !authResult?.success
                ? authResult?.message || 'Unknown authentication error'
                : `No session CookieJar found for user ${userId}`;

            if (message.includes('Invalid Email or password')) {
                await logger.error(
                    'Portal authentication failed during name search: ' + message,
                    undefined,
                    {
                        userId,
                        searchId,
                    }
                );
            } else {
                await logger.critical(
                    'Portal authentication failed during name search: ' + message,
                    undefined,
                    {
                        userId,
                        searchId,
                    }
                );
            }

            await StorageClient.saveNameSearch(searchId, {
                ...nameSearch,
                status: 'failed',
                message: `Authentication failed: ${message}`,
            });

            // Delete the queue item since we've saved the failed status
            await QueueClient.deleteMessage(receiptHandle, 'search');
            return;
        }

        // Search for cases by name
        const searchResult = await fetchCasesByName(
            nameSearch.normalizedName,
            authResult.cookieJar,
            dateOfBirth,
            soundsLike
        );

        if (searchResult.error) {
            await logger.error(
                'Name search failed with error: ' + searchResult.error,
                new Error(searchResult.error),
                {
                    userId,
                    searchId,
                    name,
                }
            );

            await StorageClient.saveNameSearch(searchId, {
                ...nameSearch,
                status: 'failed',
                message: `Search failed: ${searchResult.error}`,
            });

            await QueueClient.deleteMessage(receiptHandle, 'search');
            return;
        }

        if (searchResult.cases.length === 0) {
            // No cases found
            console.log(`No cases found for name ${name}`);

            await StorageClient.saveNameSearch(searchId, {
                ...nameSearch,
                status: 'complete',
                cases: [],
            });

            await QueueClient.deleteMessage(receiptHandle, 'search');
            return;
        }

        // Found cases - queue them for processing and update the name search
        const casesToProcess = searchResult.cases;
        console.log(`Found ${casesToProcess.length} cases for name ${name}`);

        // Update the name search with the case numbers and set status to complete
        const caseNumbers = casesToProcess.map(caseItem => caseItem.caseNumber);
        await StorageClient.saveNameSearch(searchId, {
            ...nameSearch,
            status: 'complete',
            cases: caseNumbers,
        });

        // Queue all found cases for search
        await QueueClient.queueCasesForDataRetrieval(userId, casesToProcess);

        // Delete the name search queue item
        await QueueClient.deleteMessage(receiptHandle, 'search');
    } catch (error) {
        await logger.error('Failed to process name search record', error as Error, {
            searchId,
            name,
            userId,
        });

        // Try to save failure status
        try {
            const nameSearch = await StorageClient.getNameSearch(searchId);
            if (nameSearch) {
                await StorageClient.saveNameSearch(searchId, {
                    ...nameSearch,
                    status: 'failed',
                    message: `Error: ${(error as Error).message}`,
                });
            }
        } catch (saveError) {
            console.error('Failed to save error status:', saveError);
        }

        // Delete the message to prevent retries
        await QueueClient.deleteMessage(receiptHandle, 'search');
    }
}

