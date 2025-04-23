import { SQSHandler, SQSEvent } from 'aws-lambda';
import QueueClient from './QueueClient';
import SearchParser from './SearchParser';
import StorageClient from './StorageClient';
import PortalAuthenticator from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';
import {
    CaseSearchRequest,
    CaseSearchResponse,
    SearchResult,
    NameSearchResponse,
    NameSearchData
} from '../../shared/types';
import { CookieJar } from 'tough-cookie';
import { FetchStatus } from '../../shared/types/ZipCase';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import UserAgentClient from './UserAgentClient';
import NameParser from './NameParser';

// Define union types for discriminating between search message types
interface CaseSearchMessage {
    messageType: 'case';
    caseNumber: string;
    userId: string;
    userAgent?: string;
    timestamp: number;
}

interface NameSearchMessage {
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

// Process API case search requests
export async function processCaseSearchRequest(req: CaseSearchRequest): Promise<CaseSearchResponse> {
    let caseNumbers = SearchParser.parseSearchInput(req.input);
    caseNumbers = Array.from(new Set(caseNumbers));

    if (caseNumbers.length === 0) {
        return { results: {} };
    }

    // Get existing results from storage
    const results: Record<string, SearchResult> = await StorageClient.getSearchResults(caseNumbers);

    // Get or create a user session first - this is critical for portal authentication
    const userSession = await PortalAuthenticator.getOrCreateUserSession(req.userId, req.userAgent);

    if (!userSession.success) {
        // Failed to get or create a session - update all cases with failed status
        for (const caseNumber of caseNumbers) {
            results[caseNumber] = {
                zipCase: {
                    caseNumber,
                    fetchStatus: {
                        status: 'failed',
                        message: `Authentication failed: ${userSession.message}`,
                    },
                },
            };
        }
        return { results };
    }

    // Cases that need to be queued (not found or in terminal states)
    const casesToQueue: string[] = [];

    for (const caseNumber of caseNumbers) {
        try {
            // Check if the case exists and if its status should be preserved
            if (caseNumber in results) {
                const status = results[caseNumber].zipCase.fetchStatus.status;

                // Keep the existing status for all these states
                if (['complete', 'processing', 'found', 'notFound'].includes(status)) {
                    console.log(`Case ${caseNumber} already has status ${status}, preserving`);

                    // Handle 'found' cases specially - queue directly for data retrieval
                    if (status === 'found' && results[caseNumber].zipCase.caseId) {
                        // Skip adding to search queue since it's already found
                        // Instead, queue directly for data retrieval if not already complete
                        console.log(
                            `Case ${caseNumber} has 'found' status with caseId, queueing for data retrieval`
                        );
                        try {
                            const caseId = results[caseNumber].zipCase.caseId;
                            if (caseId) {
                                await QueueClient.queueCaseForDataRetrieval(
                                    caseNumber,
                                    caseId,
                                    req.userId
                                );
                            } else {
                                console.error(
                                    `Case ${caseNumber} has 'found' status but missing caseId`
                                );
                            }
                        } catch (error) {
                            console.error(
                                `Error queueing case ${caseNumber} for data retrieval:`,
                                error
                            );
                        }
                        continue;
                    }

                    // For other non-terminal states, queue for normal search processing
                    if (!['complete', 'notFound', 'failed'].includes(status)) {
                        casesToQueue.push(caseNumber);
                    }
                    continue;
                }

                // For other statuses (failed, queued), we'll re-queue
                casesToQueue.push(caseNumber);
            } else {
                // Case doesn't exist yet - create it with queued status and add to queue
                results[caseNumber] = {
                    zipCase: {
                        caseNumber,
                        fetchStatus: { status: 'queued' },
                    },
                };

                // Save the new case to storage
                await StorageClient.saveCase({
                    caseNumber,
                    fetchStatus: { status: 'queued' },
                });

                casesToQueue.push(caseNumber);
            }
        } catch (error) {
            console.error(`Error processing case ${caseNumber}:`, error);
            results[caseNumber] = {
                zipCase: {
                    caseNumber,
                    fetchStatus: { status: 'failed', message: (error as Error).message },
                },
            };
        }
    }

    if (casesToQueue.length > 0) {
        console.log(`Queueing ${casesToQueue.length} cases for processing`);
        await QueueClient.queueCasesForSearch(casesToQueue, req.userId, req.userAgent);
    }

    return { results };
}

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
            error = `Name could not be parsed from input ${req.name}`;
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
            req.name,
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
                await processCaseSearchRecord({
                    messageType: 'case',
                    ...messageBody,
                    receiptHandle: record.receiptHandle
                }, searchLogger);
            } else if (messageBody.searchId && messageBody.name) {
                // This is a name search message
                await processNameSearchRecord({
                    messageType: 'name',
                    ...messageBody,
                    receiptHandle: record.receiptHandle
                }, searchLogger);
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

// For type hinting and clearer error handling
interface CaseSearchResult {
    caseId: string | null;
    error?: {
        message: string;
        isSystemError: boolean; // true for system errors, false for "not found"
    };
}

// Process a case search message
async function processCaseSearchRecord(
    message: CaseSearchMessage & { receiptHandle: string },
    logger: ReturnType<typeof AlertService.forCategory>
): Promise<void> {
    const { caseNumber, userId, userAgent, receiptHandle } = message;
    console.log(`Processing case search for case ${caseNumber} (user: ${userId})`);

    try {
        const now = new Date();
        const isoNow = now.toISOString();

        const zipCase = await StorageClient.getCase(caseNumber);

        if (zipCase) {
            const fetchStatus = zipCase.fetchStatus.status;

            // If already in a found or complete state, no need to search for the case again
            if (['found', 'complete'].includes(fetchStatus) && zipCase.caseId) {
                // Case ID is already known, delete the search queue item
                await QueueClient.deleteMessage(receiptHandle, 'search');
                console.log(`Case ${caseNumber} already has a caseId; deleted search queue item`);
                return;
            }

            if (['queued', 'failed', 'notFound'].includes(fetchStatus)) {
                await StorageClient.saveCase({
                    caseNumber,
                    fetchStatus: { status: 'processing' },
                    lastUpdated: isoNow,
                });
            } else if (fetchStatus === 'processing') {
                // Handle processing timeout (5 minutes)
                const lastUpdated = zipCase.lastUpdated
                    ? new Date(zipCase.lastUpdated)
                    : new Date(0);
                const minutesDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60);

                if (minutesDiff < 5) {
                    console.log(
                        `Case ${caseNumber} is already being processed (${minutesDiff.toFixed(1)} mins), skipping`
                    );
                    return;
                }

                console.log(
                    `Reprocessing case ${caseNumber} after timeout in 'processing' state (${minutesDiff.toFixed(1)} mins)`
                );
            }
        }

        // Authenticate with the portal
        const authResult = await PortalAuthenticator.getOrCreateUserSession(userId, userAgent);

        if (!authResult?.success || !authResult.cookieJar) {
            const message = !authResult?.success
                ? authResult?.message || 'Unknown authentication error'
                : `No session CookieJar found for user ${userId}`;

            if (message.includes('Invalid Email or password')) {
                await logger.error('Portal authentication failed during case search: ' + message, undefined, {
                    userId,
                    caseNumber
                });
            } else {
                await logger.critical('Portal authentication failed during case search: ' + message, undefined, {
                    userId,
                    caseNumber
                });
            }

            const failedStatus: FetchStatus = { status: 'failed', message };

            await StorageClient.saveCase({
                caseNumber,
                fetchStatus: failedStatus,
                lastUpdated: isoNow,
                caseId: zipCase?.caseId,
            });

            // Delete the queue item since we've saved the failed status
            await QueueClient.deleteMessage(receiptHandle, 'search');
            console.log(
                `Authentication failed for user ${userId}; deleted search queue item for case ${caseNumber}`
            );

            return;
        }

        // Search for the case ID
        const searchResult = await fetchCaseIdFromPortal(caseNumber, authResult.cookieJar);

        if (!searchResult.caseId) {
            // Check if this is a system error or a "not found" case
            if (searchResult.error && searchResult.error.isSystemError) {
                // System error - mark as failed
                await logger.error(
                    'Case search failed with system error: ' + searchResult.error.message,
                    new Error(searchResult.error.message),
                    {
                        userId,
                        caseNumber,
                        resource: 'case-search'
                    }
                );

                const failedStatus: FetchStatus = {
                    status: 'failed',
                    message: searchResult.error.message,
                };

                await StorageClient.saveCase({
                    caseNumber,
                    fetchStatus: failedStatus,
                    lastUpdated: isoNow,
                });

                await QueueClient.deleteMessage(receiptHandle, 'search');
                return;
            } else {
                // Not found - legitimate case not found scenario
                console.warn(`Case not found: ${caseNumber} for user ${userId}`);

                const notFoundStatus: FetchStatus = { status: 'notFound' };

                await StorageClient.saveCase({
                    caseNumber,
                    fetchStatus: notFoundStatus,
                    lastUpdated: isoNow,
                });

                await QueueClient.deleteMessage(receiptHandle, 'search');
                return;
            }
        }

        const caseId = searchResult.caseId;

        // Found the case - update status to 'found' and queue for data retrieval
        const foundStatus: FetchStatus = { status: 'found' };
        await StorageClient.saveCase({
            caseNumber,
            caseId,
            fetchStatus: foundStatus,
            lastUpdated: isoNow,
        });

        // Delete the search queue item
        await QueueClient.deleteMessage(receiptHandle, 'search');

        // Queue the case for data retrieval
        await QueueClient.queueCaseForDataRetrieval(caseNumber, caseId, userId);
        console.log(`Case ${caseNumber} found with ID ${caseId}, queued for data retrieval`);
    } catch (error) {
        const message = `Unhandled error while searching case ${caseNumber}: ${(error as Error).message}`;

        await logger.error(
            'Unhandled error during case search',
            error as Error,
            { caseNumber, userId }
        );

        // Try to save failure status
        try {
            await StorageClient.saveCase({
                caseNumber,
                fetchStatus: { status: 'failed', message },
                lastUpdated: new Date().toISOString(),
            });
        } catch (saveError) {
            console.error('Failed to save error status:', saveError);
        }

        // Delete the message to prevent retries
        await QueueClient.deleteMessage(receiptHandle, 'search');
    }
}

async function fetchCaseIdFromPortal(
    caseNumber: string,
    cookieJar: CookieJar
): Promise<CaseSearchResult> {
    try {
        // Get the portal URL from environment variable
        const portalUrl = process.env.PORTAL_URL;

        if (!portalUrl) {
            const errorMsg = 'PORTAL_URL environment variable is not set';

            await AlertService.logError(
                Severity.CRITICAL,
                AlertCategory.SYSTEM,
                'Missing required environment variable: PORTAL_URL',
                new Error(errorMsg),
                { resource: 'case-search' }
            );

            return {
                caseId: null,
                error: {
                    message: 'Portal URL environment variable is not set',
                    isSystemError: true,
                },
            };
        }

        const userAgent = await UserAgentClient.getUserAgent('system');

        const client = wrapper(axios).create({
            timeout: 20000,
            maxRedirects: 10,
            validateStatus: status => status < 500, // Only reject on 5xx errors
            jar: cookieJar,
            withCredentials: true,
            headers: {
                ...PortalAuthenticator.getDefaultRequestHeaders(userAgent),
                Origin: portalUrl,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        console.log(`Searching for case number ${caseNumber}`);

        // Step 1: Submit the search form (following the Insomnia export)
        const searchFormData = new URLSearchParams();
        searchFormData.append('caseCriteria.SearchCriteria', caseNumber);
        searchFormData.append('caseCriteria.SearchCases', 'true');

        const searchResponse = await client.post(
            `${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`,
            searchFormData
        );

        if (searchResponse.status !== 200) {
            const errorMessage = `Search request failed with status ${searchResponse.status}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Case search request failed',
                new Error(errorMessage),
                {
                    caseNumber,
                    statusCode: searchResponse.status,
                    resource: 'portal-search',
                }
            );

            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true,
                },
            };
        }

        // Step 2: Get the search results page
        const resultsResponse = await client.get(
            `${portalUrl}/Portal/SmartSearch/SmartSearchResults`
        );

        if (resultsResponse.status !== 200) {
            const errorMessage = `Results request failed with status ${resultsResponse.status}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Case search results request failed',
                new Error(errorMessage),
                {
                    caseNumber,
                    statusCode: resultsResponse.status,
                    resource: 'portal-search-results',
                }
            );

            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true,
                },
            };
        }

        // Check for the specific error message
        if (
            resultsResponse.data.includes('Smart Search is having trouble processing your search')
        ) {
            const errorMessage =
                'Smart Search is having trouble processing your search. Please try again later.';

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Smart Search processing error',
                new Error(errorMessage),
                {
                    caseNumber,
                    resource: 'smart-search',
                }
            );

            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true,
                },
            };
        }

        // Step 3: Extract the case ID from the response using cheerio
        const $ = cheerio.load(resultsResponse.data);

        // Look for anchor tags with class "caseLink" and get the data-caseid attribute
        // From the Insomnia export's after-response script
        const caseLinks = $('a.caseLink');

        if (caseLinks.length === 0) {
            console.log(`No cases found for case number ${caseNumber}`);
            return {
                caseId: null,
                error: {
                    message: `No cases found for case number ${caseNumber}`,
                    isSystemError: false, // This is a "not found" scenario, not a system error
                },
            };
        }

        // Extract the first case ID (per requirement to just use one)
        const caseId = caseLinks.first().attr('data-caseid');

        if (!caseId) {
            const errorMessage = `No case ID found in search results for ${caseNumber}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'No case ID found in search results',
                new Error(errorMessage),
                {
                    caseNumber,
                    resource: 'case-search-results',
                }
            );
            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true, // This is more of a system issue
                },
            };
        }

        console.log(`Found case ID ${caseId} for case number ${caseNumber}`);
        return { caseId };
    } catch (error) {
        const errorMessage = `Error fetching case ID from portal: ${(error as Error).message}`;

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.PORTAL,
            'Failed to fetch case ID from portal',
            error as Error,
            {
                caseNumber,
                resource: 'case-id-fetch',
            }
        );

        return {
            caseId: null,
            error: {
                message: errorMessage,
                isSystemError: true,
            },
        };
    }
}

// Name search result interface
interface NameSearchResult {
    caseNumbers: string[];
    error?: string;
}

// Process a name search message
async function processNameSearchRecord(
    message: NameSearchMessage & { receiptHandle: string },
    logger: ReturnType<typeof AlertService.forCategory>
): Promise<void> {
    const { searchId, name, userId, dateOfBirth, soundsLike, userAgent, receiptHandle } = message;
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
                        searchId
                    }
                );
            } else {
                await logger.critical(
                    'Portal authentication failed during name search: ' + message,
                    undefined,
                    {
                        userId,
                        searchId
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
                    name
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

        if (searchResult.caseNumbers.length === 0) {
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
        const caseNumbers = searchResult.caseNumbers;
        console.log(`Found ${caseNumbers.length} cases for name ${name}`);

        // Update the name search with the case numbers and set status to complete
        await StorageClient.saveNameSearch(searchId, {
            ...nameSearch,
            status: 'complete',
            cases: caseNumbers,
        });

        // Queue all found cases for search
        await QueueClient.queueCasesForSearch(caseNumbers, userId, userAgent);

        // Delete the name search queue item
        await QueueClient.deleteMessage(receiptHandle, 'search');
    } catch (error) {
        await logger.error('Failed to process name search record', error as Error, {
            searchId,
            name,
            userId
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

async function fetchCasesByName(
    name: string,
    cookieJar: CookieJar,
    dateOfBirth?: string,
    soundsLike: boolean = false
): Promise<NameSearchResult> {
    try {
        // Get the portal URL from environment variable
        const portalUrl = process.env.PORTAL_URL;

        if (!portalUrl) {
            const errorMsg = 'PORTAL_URL environment variable is not set';

            await AlertService.logError(
                Severity.CRITICAL,
                AlertCategory.SYSTEM,
                'Missing required environment variable: PORTAL_URL',
                new Error(errorMsg),
                { resource: 'name-search' }
            );

            return {
                caseNumbers: [],
                error: 'Portal URL environment variable is not set',
            };
        }

        const userAgent = await UserAgentClient.getUserAgent('system');

        const client = wrapper(axios).create({
            timeout: 20000,
            maxRedirects: 10,
            validateStatus: status => status < 500, // Only reject on 5xx errors
            jar: cookieJar,
            withCredentials: true,
            headers: {
                ...PortalAuthenticator.getDefaultRequestHeaders(userAgent),
                Origin: portalUrl,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        console.log(`Searching for name: ${name}, DOB: ${dateOfBirth || 'not provided'}`);

        // Step 1: Submit the search form with name parameter
        const searchFormData = new URLSearchParams();
        searchFormData.append('caseCriteria.SearchCriteria', name);
        searchFormData.append('caseCriteria.SearchByPartyName', 'true');
        searchFormData.append('caseCriteria.SearchCases', 'true');

        // If date of birth provided, set both DOBFrom and DOBTo
        if (dateOfBirth) {
            searchFormData.append('caseCriteria.DOBFrom', dateOfBirth);
            searchFormData.append('caseCriteria.DOBTo', dateOfBirth);
        }

        // Add sound-alike search if requested
        if (soundsLike) {
            searchFormData.append('caseCriteria.UseSoundex', 'true');
        }

        const searchResponse = await client.post(
            `${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`,
            searchFormData
        );

        if (searchResponse.status !== 200) {
            const errorMessage = `Search request failed with status ${searchResponse.status}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Name search request failed',
                new Error(errorMessage),
                {
                    name,
                    statusCode: searchResponse.status,
                    resource: 'portal-search',
                }
            );

            return {
                caseNumbers: [],
                error: errorMessage,
            };
        }

        // Step 2: Get the search results page
        const resultsResponse = await client.get(
            `${portalUrl}/Portal/SmartSearch/SmartSearchResults`
        );

        if (resultsResponse.status !== 200) {
            const errorMessage = `Results request failed with status ${resultsResponse.status}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Name search results request failed',
                new Error(errorMessage),
                {
                    name,
                    statusCode: resultsResponse.status,
                    resource: 'portal-search-results',
                }
            );

            return {
                caseNumbers: [],
                error: errorMessage,
            };
        }

        // Check for specific error messages
        if (
            resultsResponse.data.includes('Smart Search is having trouble processing your search')
        ) {
            const errorMessage =
                'Smart Search is having trouble processing your search. Please try again later.';

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Smart Search processing error',
                new Error(errorMessage),
                {
                    name,
                    resource: 'smart-search',
                }
            );

            return {
                caseNumbers: [],
                error: errorMessage,
            };
        }

        // Step 3: Extract all case IDs and numbers from the response using cheerio
        const $ = cheerio.load(resultsResponse.data);
        const caseLinks = $('a.caseLink');

        if (caseLinks.length === 0) {
            console.log(`No cases found for name ${name}`);
            return { caseNumbers: [] };
        }

        // Extract all case numbers (this is different from the case search implementation
        // which only extracts the first case)
        const caseNumbers: string[] = [];

        caseLinks.each((_, element) => {
            const caseNumberSpan = $(element).find('.block-link__primary');
            if (caseNumberSpan.length > 0) {
                const caseNumber = caseNumberSpan.text().trim();
                if (caseNumber) {
                    caseNumbers.push(caseNumber);
                }
            }
        });

        if (caseNumbers.length === 0) {
            console.log(`No valid case numbers found for name ${name}`);
            return { caseNumbers: [] };
        }

        console.log(`Found ${caseNumbers.length} cases for name ${name}`);
        return { caseNumbers };
    } catch (error) {
        const errorMessage = `Error searching by name: ${(error as Error).message}`;

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.PORTAL,
            'Failed to search by name',
            error as Error,
            {
                name,
                resource: 'name-search',
            }
        );

        return {
            caseNumbers: [],
            error: errorMessage,
        };
    }
}
