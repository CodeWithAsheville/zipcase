import { SQSHandler, SQSEvent, SQSRecord } from 'aws-lambda';
import PortalAuthenticator from './PortalAuthenticator';
import QueueClient from './QueueClient';
import StorageClient from './StorageClient';
import UserAgentClient from './UserAgentClient';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { CaseSummary, FetchStatus } from '../../shared/types';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';

// Process the case search queue - responsible for finding caseId (status: 'found')
const processCaseSearch: SQSHandler = async (event: SQSEvent, context, callback) => {
    console.log(`Received ${event.Records.length} case search messages`);

    // Create specialized logger for case search
    const caseSearchLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, userId, userAgent } = messageBody;

            if (!caseNumber || !userId) {
                await caseSearchLogger.error(
                    'Invalid message format, missing required fields',
                    undefined,
                    { caseNumber, userId, messageId: record.messageId }
                );
                continue;
            }

            console.log(`Searching for case ${caseNumber} for user ${userId}`);
            await processCaseSearchRecord(caseNumber, userId, record.receiptHandle, userAgent);
        } catch (error) {
            await caseSearchLogger.error('Failed to process case search record', error as Error, {
                messageId: record.messageId,
            });
        }
    }
};

// Process the case data queue - responsible for fetching case data (status: 'complete')
const processCaseData: SQSHandler = async (event: SQSEvent, context, callback) => {
    console.log(`Received ${event.Records.length} case data messages`);

    // Create specialized logger for case data
    const caseDataLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, caseId, userId } = messageBody;

            if (!caseNumber || !caseId || !userId) {
                await caseDataLogger.error(
                    'Invalid message format, missing required fields',
                    undefined,
                    { caseNumber, caseId, userId, messageId: record.messageId }
                );
                continue;
            }

            console.log(`Fetching data for case ${caseNumber} (ID: ${caseId}) for user ${userId}`);
            await processCaseDataRecord(caseNumber, caseId, userId, record.receiptHandle);
        } catch (error) {
            await caseDataLogger.error('Failed to process case data record', error as Error, {
                messageId: record.messageId,
            });
        }
    }
};

function queueCasesForSearch(cases: Array<string>, userId: string): Promise<void> {
    return QueueClient.queueCasesForSearch(cases, userId);
}

// Process a case search message - responsible for finding the caseId
async function processCaseSearchRecord(
    caseNumber: string,
    userId: string,
    receiptHandle: string,
    userAgent?: string
): Promise<FetchStatus> {
    try {
        const now = new Date();
        const nowTime = now.getTime();
        const isoNow = now.toISOString();

        const zipCase = await StorageClient.getCase(caseNumber);

        if (zipCase) {
            const fetchStatus = zipCase.fetchStatus.status;

            // If already in a found or complete state, no need to search for the case again
            if (['found', 'complete'].includes(fetchStatus) && zipCase.caseId) {
                // Case ID is already known, delete the search queue item
                await QueueClient.deleteMessage(receiptHandle, 'search');
                console.log(`Case ${caseNumber} already has a caseId; deleted search queue item`);
                return zipCase.fetchStatus;
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
                const minutesDiff = (nowTime - lastUpdated.getTime()) / (1000 * 60);

                if (minutesDiff < 5) {
                    console.log(
                        `Case ${caseNumber} is already being processed (${minutesDiff.toFixed(1)} mins), skipping`
                    );
                    return zipCase.fetchStatus;
                }

                console.log(
                    `Reprocessing case ${caseNumber} after timeout in 'processing' state (${minutesDiff.toFixed(1)} mins)`
                );
            }
        }

        // Authenticate with the portal, passing along the user agent if available
        const authResult = await PortalAuthenticator.getOrCreateUserSession(userId, userAgent);

        if (!authResult?.success || !authResult.cookieJar) {
            const message = !authResult?.success
                ? authResult?.message || 'Unknown authentication error'
                : `No session CookieJar found for user ${userId}`;

            await AlertService.logError(
                // Use ERROR level if it's a credentials issue, CRITICAL for system issues
                message.includes('Invalid Email or password') ? Severity.ERROR : Severity.CRITICAL,
                AlertCategory.AUTHENTICATION,
                'Portal authentication failed during case search',
                undefined,
                {
                    userId,
                    caseNumber,
                    message,
                }
            );

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

            return failedStatus;
        }

        // Search for the case ID
        const searchResult = await fetchCaseIdFromPortal(caseNumber, authResult.cookieJar);

        if (!searchResult.caseId) {
            // Check if this is a system error or a "not found" case
            if (searchResult.error && searchResult.error.isSystemError) {
                // System error - mark as failed
                await AlertService.logError(
                    Severity.ERROR,
                    AlertCategory.PORTAL,
                    'Case search failed with system error',
                    new Error(searchResult.error.message),
                    {
                        userId,
                        caseNumber,
                        resource: 'case-search',
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
                return failedStatus;
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
                return notFoundStatus;
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

        return foundStatus;
    } catch (error) {
        const message = `Unhandled error while searching case ${caseNumber}: ${(error as Error).message}`;

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.SYSTEM,
            'Unhandled error during case search',
            error as Error,
            { caseNumber, userId }
        );

        return { status: 'failed', message };
    }
}

// Process a case data message - responsible for fetching case details
async function processCaseDataRecord(
    caseNumber: string,
    caseId: string,
    userId: string,
    receiptHandle: string
): Promise<FetchStatus> {
    try {
        const now = new Date();
        const nowTime = now.getTime();
        const isoNow = now.toISOString();

        const zipCase = await StorageClient.getCase(caseNumber);

        // Skip if already complete or in 'found' status recently - always use cache
        if (zipCase) {
            if (zipCase.fetchStatus.status === 'complete') {
                // Always use the cached data for complete cases
                await QueueClient.deleteMessage(receiptHandle, 'data');
                console.log(
                    `Case ${caseNumber} already complete; using cached data and deleted queue item`
                );
                return zipCase.fetchStatus;
            }

            // For 'found' cases, add a protection against duplicate processing
            // This might happen if the case is queued multiple times due to polling
            if (zipCase.fetchStatus.status === 'found' && zipCase.lastUpdated) {
                const lastUpdated = new Date(zipCase.lastUpdated);
                const minutesDiff = (nowTime - lastUpdated.getTime()) / (1000 * 60);

                if (minutesDiff < 1) {
                    console.log(
                        `Case ${caseNumber} already in 'found' status recently (${minutesDiff.toFixed(1)} mins ago); deleted duplicate queue item`
                    );
                    await QueueClient.deleteMessage(receiptHandle, 'data');
                    return zipCase.fetchStatus;
                }
            }
        }

        // Fetch case summary
        const caseSummary = await fetchCaseSummary(caseId);

        // Update to complete status
        const completeStatus: FetchStatus = { status: 'complete' };
        await StorageClient.saveCase({
            caseNumber,
            caseId,
            fetchStatus: completeStatus,
            lastUpdated: isoNow,
        });

        // Save the case summary if available
        if (caseSummary) {
            await StorageClient.saveCaseSummary(caseNumber, caseSummary);
        }

        // Delete the data queue item
        await QueueClient.deleteMessage(receiptHandle, 'data');
        console.log(`Successfully completed data retrieval for case ${caseNumber}`);

        return completeStatus;
    } catch (error) {
        const message = `Unhandled error while retrieving data for case ${caseNumber}: ${(error as Error).message}`;

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.SYSTEM,
            'Unhandled error during case data retrieval',
            error as Error,
            { caseNumber, caseId, userId }
        );

        return { status: 'failed', message };
    }
}

// For type hinting and clearer error handling
interface CaseSearchResult {
    caseId: string | null;
    error?: {
        message: string;
        isSystemError: boolean; // true for system errors, false for "not found"
    };
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

async function fetchCaseSummary(caseId: string): Promise<CaseSummary | null> {
    try {
        const portalCaseUrl = process.env.PORTAL_CASE_URL;

        if (!portalCaseUrl) {
            const errorMsg = 'PORTAL_CASE_URL environment variable is not set';

            await AlertService.logError(
                Severity.CRITICAL,
                AlertCategory.SYSTEM,
                'Missing required environment variable: PORTAL_CASE_URL',
                new Error(errorMsg),
                { caseId }
            );

            return null;
        }

        const userAgent = await UserAgentClient.getUserAgent('system');

        const client = axios.create({
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: status => status < 400,
            headers: {
                'User-Agent': userAgent,
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                Referer: portalCaseUrl,
            },
        });

        const summaryResponse = await client.get(
            `${portalCaseUrl}Service/CaseSummariesSlim?key=${caseId}`
        );
        if (summaryResponse.status !== 200) {
            const errorMessage = `Case summary request failed with status ${summaryResponse.status}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Failed to fetch case summary',
                new Error(errorMessage),
                {
                    caseId,
                    statusCode: summaryResponse.status,
                    resource: 'case-summary',
                }
            );

            return null;
        }

        const { data } = summaryResponse;
        const summary: CaseSummary = {
            caseName: data.CaseSummaryHeader.Style,
            court: data.CaseSummaryHeader.Heading,
        };

        // const dispositionEventsResponse = await client.get(`${portalCaseUrl}/Service/DispositionEvents('${caseId}')`);
        // if (summaryResponse.status !== 200) {
        //     console.error(`Case summary request failed with status ${summaryResponse.status}`);
        //     return null;
        // }

        return summary;
    } catch (error) {
        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.PORTAL,
            'Error fetching case summary',
            error as Error,
            {
                caseId,
                resource: 'case-summary',
            }
        );
        return null;
    }
}

const CaseProcessor = {
    processCaseSearch,
    processCaseData,
    queueCasesForSearch,
    fetchCaseIdFromPortal,
};

export default CaseProcessor;
