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

// Track last request time per user to detect potential race conditions
const lastRequestTimes = new Map<string, number>();
const MIN_REQUEST_INTERVAL_MS = 100; // Minimum time between requests (adjust as needed)

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
    const requestId = `${caseNumber}-${Date.now()}`;
    const timings: Record<string, number> = {};
    const startTime = Date.now();

    // Check for potential race conditions
    const lastRequestTime = lastRequestTimes.get(caseNumber);
    if (lastRequestTime) {
        const timeSinceLastRequest = startTime - lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
            console.warn(
                `[${requestId}] POTENTIAL RACE CONDITION: Request for ${caseNumber} made ${timeSinceLastRequest}ms after previous request (< ${MIN_REQUEST_INTERVAL_MS}ms threshold)`
            );
        }
    }
    lastRequestTimes.set(caseNumber, startTime);

    // Clean up old entries (older than 5 minutes)
    const fiveMinutesAgo = startTime - 5 * 60 * 1000;
    for (const [key, time] of lastRequestTimes.entries()) {
        if (time < fiveMinutesAgo) {
            lastRequestTimes.delete(key);
        }
    }

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

        // Log cookie state for debugging
        const cookies = await cookieJar.getCookies(portalUrl);
        console.log(`[${requestId}] Starting case search with ${cookies.length} cookies`, {
            caseNumber,
            cookieNames: cookies.map(c => c.key),
            userAgent,
        });

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

        // Track request timings
        const requestTimings = new Map<string, number>();

        // Add request interceptor for detailed logging
        client.interceptors.request.use(
            config => {
                const requestStart = Date.now();
                const reqKey = `${config.method}-${config.url}`;
                requestTimings.set(reqKey, requestStart);

                console.log(`[${requestId}] >>> Outgoing request`, {
                    method: config.method?.toUpperCase(),
                    url: config.url,
                    headers: config.headers,
                    hasData: !!config.data,
                    dataLength: config.data ? String(config.data).length : 0,
                });
                return config;
            },
            error => {
                console.error(`[${requestId}] Request interceptor error`, error);
                return Promise.reject(error);
            }
        );

        // Add response interceptor for detailed logging
        client.interceptors.response.use(
            response => {
                const reqKey = `${response.config.method}-${response.config.url}`;
                const startTime = requestTimings.get(reqKey) || Date.now();
                const duration = Date.now() - startTime;
                requestTimings.delete(reqKey);

                console.log(`[${requestId}] <<< Incoming response`, {
                    status: response.status,
                    statusText: response.statusText,
                    duration,
                    headers: response.headers,
                    dataLength: response.data ? String(response.data).length : 0,
                    url: response.config.url,
                });
                return response;
            },
            error => {
                const reqKey = `${error.config?.method}-${error.config?.url}`;
                const startTime = requestTimings.get(reqKey) || Date.now();
                const duration = Date.now() - startTime;
                requestTimings.delete(reqKey);

                console.error(`[${requestId}] <<< Error response`, {
                    duration,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    headers: error.response?.headers,
                    url: error.config?.url,
                    code: error.code,
                    message: error.message,
                });
                return Promise.reject(error);
            }
        );

        console.log(`[${requestId}] Searching for case number ${caseNumber}`);

        // Step 1: Submit the search form (following the Insomnia export)
        const searchFormData = new URLSearchParams();
        searchFormData.append('caseCriteria.SearchCriteria', caseNumber);
        searchFormData.append('caseCriteria.SearchCases', 'true');

        const searchUrl = `${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`;
        console.log(`[${requestId}] POST ${searchUrl}`, {
            formData: Object.fromEntries(searchFormData.entries()),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Origin: portalUrl,
                'User-Agent': userAgent,
            },
        });

        const searchStartTime = Date.now();
        const searchResponse = await client.post(searchUrl, searchFormData);
        timings.searchRequest = Date.now() - searchStartTime;

        console.log(`[${requestId}] Search form submission response`, {
            status: searchResponse.status,
            statusText: searchResponse.statusText,
            duration: timings.searchRequest,
            headers: searchResponse.headers,
            redirects: searchResponse.request?._redirectable?._redirectCount,
        });

        if (searchResponse.status !== 200) {
            const errorMessage = `Search request failed with status ${searchResponse.status}`;
            const responseBody =
                typeof searchResponse.data === 'string'
                    ? searchResponse.data.substring(0, 1000)
                    : JSON.stringify(searchResponse.data).substring(0, 1000);

            console.error(`[${requestId}] Search request failed`, {
                status: searchResponse.status,
                statusText: searchResponse.statusText,
                headers: searchResponse.headers,
                bodyPreview: responseBody,
                duration: timings.searchRequest,
            });

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                requestId,
                caseNumber,
                statusCode: searchResponse.status,
                statusText: searchResponse.statusText,
                duration: timings.searchRequest,
                bodyPreview: responseBody,
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
        const resultsUrl = `${portalUrl}/Portal/SmartSearch/SmartSearchResults`;
        console.log(`[${requestId}] GET ${resultsUrl}`);

        const resultsStartTime = Date.now();
        const resultsResponse = await client.get(resultsUrl);
        timings.resultsRequest = Date.now() - resultsStartTime;

        console.log(`[${requestId}] Search results response`, {
            status: resultsResponse.status,
            statusText: resultsResponse.statusText,
            duration: timings.resultsRequest,
            headers: resultsResponse.headers,
            contentLength: resultsResponse.data?.length || 0,
        });

        if (resultsResponse.status !== 200) {
            const errorMessage = `Results request failed with status ${resultsResponse.status}`;
            const responseBody =
                typeof resultsResponse.data === 'string'
                    ? resultsResponse.data.substring(0, 1000)
                    : JSON.stringify(resultsResponse.data).substring(0, 1000);

            console.error(`[${requestId}] Results request failed`, {
                status: resultsResponse.status,
                statusText: resultsResponse.statusText,
                headers: resultsResponse.headers,
                bodyPreview: responseBody,
                duration: timings.resultsRequest,
            });

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                requestId,
                caseNumber,
                statusCode: resultsResponse.status,
                statusText: resultsResponse.statusText,
                duration: timings.resultsRequest,
                bodyPreview: responseBody,
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

            console.error(`[${requestId}] Portal smart search error`, {
                caseNumber,
                totalDuration: Date.now() - startTime,
                timings,
            });

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                requestId,
                caseNumber,
                timings,
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
        const parseStartTime = Date.now();
        const $ = cheerio.load(resultsResponse.data);
        timings.htmlParse = Date.now() - parseStartTime;

        // Look for anchor tags with class "caseLink" and get the data-caseid attribute
        // From the Insomnia export's after-response script
        const caseLinks = $('a.caseLink');

        console.log(`[${requestId}] Parsed HTML results`, {
            caseLinksFound: caseLinks.length,
            parseDuration: timings.htmlParse,
            totalDuration: Date.now() - startTime,
        });

        if (caseLinks.length === 0) {
            console.log(`[${requestId}] No cases found for case number ${caseNumber}`, {
                timings,
                totalDuration: Date.now() - startTime,
            });
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

            console.error(`[${requestId}] No case ID attribute found`, {
                caseLinksFound: caseLinks.length,
                firstLinkHtml: caseLinks.first().html()?.substring(0, 200),
                timings,
                totalDuration: Date.now() - startTime,
            });

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                requestId,
                caseNumber,
                caseLinksFound: caseLinks.length,
                timings,
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

        const totalDuration = Date.now() - startTime;
        console.log(`[${requestId}] Found case ID ${caseId} for case number ${caseNumber}`, {
            timings,
            totalDuration,
        });

        return { caseId };
    } catch (error) {
        const totalDuration = Date.now() - startTime;
        const axiosError = error as any;

        // Enhanced error logging with request/response details
        const errorDetails: Record<string, any> = {
            requestId,
            caseNumber,
            timings,
            totalDuration,
            resource: 'case-id-fetch',
        };

        // Capture axios-specific error details
        if (axiosError.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            errorDetails.responseStatus = axiosError.response.status;
            errorDetails.responseStatusText = axiosError.response.statusText;
            errorDetails.responseHeaders = axiosError.response.headers;

            // Capture response body (truncated)
            if (axiosError.response.data) {
                const responseBody =
                    typeof axiosError.response.data === 'string' ? axiosError.response.data : JSON.stringify(axiosError.response.data);
                errorDetails.responseBodyPreview = responseBody.substring(0, 1000);
            }
        } else if (axiosError.request) {
            // The request was made but no response was received
            errorDetails.requestMade = true;
            errorDetails.noResponse = true;
            errorDetails.requestTimeout = axiosError.code === 'ECONNABORTED';
        } else {
            // Something happened in setting up the request that triggered an Error
            errorDetails.setupError = true;
        }

        errorDetails.errorCode = axiosError.code;
        errorDetails.errorMessage = axiosError.message;

        console.error(`[${requestId}] Error fetching case ID from portal`, errorDetails);

        await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', error as Error, errorDetails);

        return {
            caseId: null,
            error: {
                message: `Error fetching case ID from portal: ${(error as Error).message}`,
                isSystemError: true,
            },
        };
    }
}
