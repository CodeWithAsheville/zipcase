import { CaseSearchRequest, CaseSearchResponse, SearchResult, FetchStatus } from '../../shared/types';
import QueueClient from './QueueClient';
import SearchParser from './SearchParser';
import StorageClient from './StorageClient';
import PortalAuthenticator from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import UserAgentClient from './UserAgentClient';
import { CASE_SUMMARY_VERSION_DATE } from './CaseProcessor';

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
                const caseId = results[caseNumber].zipCase.caseId;
                const caseSummary = results[caseNumber].caseSummary;

                switch (status) {
                    case 'complete':
                        const lastUpdated = results[caseNumber].zipCase.lastUpdated;
                        if (caseSummary && lastUpdated && new Date(lastUpdated) >= CASE_SUMMARY_VERSION_DATE) {
                            // Truly complete - has both ID and an up-to-date summary
                            console.log(`Case ${caseNumber} is complete with up-to-date summary schema, preserving`);
                            continue;
                        } else if (caseId) {
                            // Has ID but missing summary or summary schema is outdated - treat as 'found' and queue for data retrieval
                            console.log(
                                `Case ${caseNumber} has 'complete' status but ${caseSummary ? 'summary is outdated' : 'missing summary'}; treating as 'found' and queueing for data retrieval`
                            );

                            const nowString = new Date().toISOString();

                            // Update status to 'found', since we need to rebuild the summary
                            await StorageClient.saveCase({
                                caseNumber,
                                caseId,
                                fetchStatus: { status: 'found' },
                                lastUpdated: nowString,
                            });

                            // Also update the results object that will be returned to frontend
                            results[caseNumber].zipCase.fetchStatus = { status: 'found' };
                            results[caseNumber].zipCase.lastUpdated = nowString;

                            try {
                                await QueueClient.queueCaseForDataRetrieval(caseNumber, caseId, req.userId);
                            } catch (error) {
                                console.error(`Error queueing case ${caseNumber} for data retrieval:`, error);
                            }
                            continue;
                        } else {
                            // Complete status but no caseId - this shouldn't happen but requeue
                            console.warn(`Case ${caseNumber} has 'complete' status but missing caseId, will re-queue for search`);
                            casesToQueue.push(caseNumber);
                        }
                        break;
                    case 'found':
                    case 'reprocessing':
                        console.log(`Case ${caseNumber} already has status ${status}, preserving`);

                        // Queue for data retrieval if we have caseId
                        if (caseId) {
                            console.log(`Case ${caseNumber} has '${status}' status with caseId, queueing for data retrieval`);
                            try {
                                await QueueClient.queueCaseForDataRetrieval(caseNumber, caseId, req.userId);
                            } catch (error) {
                                console.error(`Error queueing case ${caseNumber} for data retrieval:`, error);
                            }
                            continue;
                        } else {
                            // 'found' or 'reprocessing' cases without caseId should be re-queued for search
                            console.log(`Case ${caseNumber} has '${status}' status but missing caseId, re-queueing for search`);
                            casesToQueue.push(caseNumber);
                        }
                        break;
                    case 'notFound':
                    case 'failed':
                    case 'queued':
                    case 'processing':
                        // We requeue 'queued' and 'processing' because they might be stuck.
                        // When they get picked up from the queue, we'll see whether they became 'complete' in the mean time and exit early.
                        casesToQueue.push(caseNumber);
                }
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

// For type hinting and clearer error handling
interface CaseSearchResult {
    caseId: string | null;
    error?: {
        message: string;
        isSystemError: boolean; // true for system errors, false for "not found"
    };
}

// Process a case search SQS message
export async function processCaseSearchRecord(
    caseNumber: string,
    userId: string,
    receiptHandle: string,
    logger: ReturnType<typeof AlertService.forCategory>,
    userAgent?: string
): Promise<void> {
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
                const lastUpdated = zipCase.lastUpdated ? new Date(zipCase.lastUpdated) : new Date(0);
                const minutesDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60);

                if (minutesDiff < 5) {
                    console.log(`Case ${caseNumber} is already being processed (${minutesDiff.toFixed(1)} mins), skipping`);
                    return;
                }

                console.log(`Reprocessing case ${caseNumber} after timeout in 'processing' state (${minutesDiff.toFixed(1)} mins)`);
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
                    caseNumber,
                });
            } else {
                await logger.critical('Portal authentication failed during case search: ' + message, undefined, {
                    userId,
                    caseNumber,
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
            console.log(`Authentication failed for user ${userId}; deleted search queue item for case ${caseNumber}`);

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

        await logger.error('Unhandled error during case search', error as Error, {
            caseNumber,
            userId,
        });

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

// Fetch case ID from the portal
export async function fetchCaseIdFromPortal(caseNumber: string, cookieJar: CookieJar): Promise<CaseSearchResult> {
    try {
        // Get the portal URL from environment variable
        const portalUrl = process.env.PORTAL_URL;

        if (!portalUrl) {
            const errorMsg = 'PORTAL_URL environment variable is not set';

            await AlertService.logError(Severity.CRITICAL, AlertCategory.SYSTEM, '', new Error(errorMsg), { resource: 'case-search' });

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
                'Content-Type': 'application/x-www-form-urlencoded',
                Origin: portalUrl,
                Referer: 'https://portal-nc.tylertech.cloud/Portal/Home/Dashboard/29',
            },
        });

        console.log(`Searching for case number ${caseNumber}`);

        // Step 1: Submit the search form (following the Insomnia export)
        const searchFormData = new URLSearchParams();
        searchFormData.append('caseCriteria.SearchCriteria', caseNumber);
        searchFormData.append('caseCriteria.SearchCases', 'true');

        const searchResponse = await client.post(`${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`, searchFormData);

        if (searchResponse.status !== 200) {
            const errorMessage = `Search request failed with status ${searchResponse.status}`;

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                caseNumber,
                statusCode: searchResponse.status,
                resource: 'portal-search',
            });

            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true,
                },
            };
        }

        // Step 2: Get the search results page
        const resultsResponse = await client.get(`${portalUrl}/Portal/SmartSearch/SmartSearchResults`);

        if (resultsResponse.status !== 200) {
            const errorMessage = `Results request failed with status ${resultsResponse.status}`;

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                caseNumber,
                statusCode: resultsResponse.status,
                resource: 'portal-search-results',
            });

            return {
                caseId: null,
                error: {
                    message: errorMessage,
                    isSystemError: true,
                },
            };
        }

        // Check for the specific error message
        if (resultsResponse.data.includes('Smart Search is having trouble processing your search')) {
            const errorMessage = 'Smart Search is having trouble processing your search. Please try again later.';

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                caseNumber,
                resource: 'smart-search',
            });

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

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                caseNumber,
                resource: 'case-search-results',
            });
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
        await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', error as Error, {
            caseNumber,
            resource: 'case-id-fetch',
        });

        return {
            caseId: null,
            error: {
                message: `Error fetching case ID from portal: ${(error as Error).message}`,
                isSystemError: true,
            },
        };
    }
}
