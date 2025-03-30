import { SQSHandler, SQSEvent, SQSRecord } from 'aws-lambda';
import PortalAuthenticator from './PortalAuthenticator';
import QueueClient from './QueueClient';
import StorageClient from './StorageClient';
import { CaseSummary, FetchStatus } from '../../shared/types';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';

// Process the case search queue - responsible for finding caseId (status: 'found')
const processCaseSearch: SQSHandler = async (event: SQSEvent, context, callback) => {
    console.log(`Received ${event.Records.length} case search messages`);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, userId } = messageBody;

            if (!caseNumber || !userId) {
                console.error('Invalid message format, missing caseNumber or userId');
                continue;
            }

            console.log(`Searching for case ${caseNumber} for user ${userId}`);
            await processCaseSearchRecord(caseNumber, userId, record.receiptHandle);
        } catch (error) {
            console.error('Error processing case search record:', error);
        }
    }
};

// Process the case data queue - responsible for fetching case data (status: 'complete')
const processCaseData: SQSHandler = async (event: SQSEvent, context, callback) => {
    console.log(`Received ${event.Records.length} case data messages`);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, caseId, userId } = messageBody;

            if (!caseNumber || !caseId || !userId) {
                console.error('Invalid message format, missing caseNumber, caseId, or userId');
                continue;
            }

            console.log(`Fetching data for case ${caseNumber} (ID: ${caseId}) for user ${userId}`);
            await processCaseDataRecord(caseNumber, caseId, userId, record.receiptHandle);
        } catch (error) {
            console.error('Error processing case data record:', error);
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
    receiptHandle: string
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

        // Authenticate with the portal
        const authResult = await PortalAuthenticator.getOrCreateUserSession(userId);

        if (!authResult?.success || !authResult.cookieJar) {
            const message = !authResult?.success
                ? authResult?.message || 'Unknown authentication error'
                : `No session CookieJar found for user ${userId}`;

            console.error(`No session existed or could be created for user ${userId}: ${message}`);

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
                console.error(
                    `Search failed for case ${caseNumber}: ${searchResult.error.message}`
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
        console.error(message);
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
        console.error(message);
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
            console.error('Error: PORTAL_URL environment variable is not set');
            return {
                caseId: null,
                error: {
                    message: 'Portal URL environment variable is not set',
                    isSystemError: true,
                },
            };
        }

        const client = wrapper(axios).create({
            timeout: 20000,
            maxRedirects: 10,
            validateStatus: status => status < 500, // Only reject on 5xx errors
            jar: cookieJar,
            withCredentials: true,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
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
            console.error(errorMessage);
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
            console.error(errorMessage);
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
            console.error(errorMessage);
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
            console.log(errorMessage);
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
        console.error(errorMessage);
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
            console.error('Error: PORTAL_CASE_URL environment variable is not set');
            return null;
        }

        const client = axios.create({
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: status => status < 400,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                Referer: portalCaseUrl,
            },
        });

        const summaryResponse = await client.get(
            `${portalCaseUrl}Service/CaseSummariesSlim?key=${caseId}`
        );
        if (summaryResponse.status !== 200) {
            console.error(`Case summary request failed with status ${summaryResponse.status}`);
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
        console.error('Error fetching case summary:', error);
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
