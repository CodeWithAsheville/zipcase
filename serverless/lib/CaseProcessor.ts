import { SQSHandler, SQSEvent } from 'aws-lambda';
import PortalAuthenticator from './PortalAuthenticator';
import QueueClient from './QueueClient';
import StorageClient from './StorageClient';
import UserAgentClient from './UserAgentClient';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { CaseSummary, Charge, Disposition, FetchStatus } from '../../shared/types';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { parseUsDate, formatIsoDate } from '../../shared/DateTimeUtils';
import * as cheerio from 'cheerio';

// Version date used to determine whether a cached 'complete' CaseSummary is
// up-to-date or should be re-fetched to align with current schema/logic.
export const CASE_SUMMARY_VERSION_DATE = new Date('2025-10-08T14:00:00Z');

// Type for raw portal JSON data - using `any` is acceptable here since we're dealing with
// dynamic external API responses that we don't control
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PortalApiResponse = any;

// Process the case search queue - responsible for finding caseId (status: 'found')
const processCaseSearch: SQSHandler = async (event: SQSEvent) => {
    console.log(`Received ${event.Records.length} case search messages`);

    // Create specialized logger for case search
    const caseSearchLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, userId, userAgent } = messageBody;

            if (!caseNumber || !userId) {
                await caseSearchLogger.error('Invalid message format, missing required fields', undefined, {
                    caseNumber,
                    userId,
                    messageId: record.messageId,
                });
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
const processCaseData: SQSHandler = async (event: SQSEvent) => {
    console.log(`Received ${event.Records.length} case data messages`);

    // Create specialized logger for case data
    const caseDataLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { caseNumber, caseId, userId } = messageBody;

            if (!caseNumber || !caseId || !userId) {
                await caseDataLogger.error('Invalid message format, missing required fields', undefined, {
                    caseNumber,
                    caseId,
                    userId,
                    messageId: record.messageId,
                });
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
                const lastUpdated = zipCase.lastUpdated ? new Date(zipCase.lastUpdated) : new Date(0);
                const minutesDiff = (nowTime - lastUpdated.getTime()) / (1000 * 60);

                if (minutesDiff < 5) {
                    console.log(`Case ${caseNumber} is already being processed (${minutesDiff.toFixed(1)} mins), skipping`);
                    return zipCase.fetchStatus;
                }

                console.log(`Reprocessing case ${caseNumber} after timeout in 'processing' state (${minutesDiff.toFixed(1)} mins)`);
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
            console.log(`Authentication failed for user ${userId}; deleted search queue item for case ${caseNumber}`);

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

        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Unhandled error during case search', error as Error, {
            caseNumber,
            userId,
        });

        return { status: 'failed', message };
    }
}

// Process a case data message - responsible for fetching case details
async function processCaseDataRecord(caseNumber: string, caseId: string, userId: string, receiptHandle: string): Promise<FetchStatus> {
    try {
        // Check for existing data and skip if already complete with current schema version.
        const zipCase = await StorageClient.getCase(caseNumber);
        if (zipCase && zipCase.fetchStatus.status === 'complete') {
            const lastUpdated = zipCase.lastUpdated ? new Date(zipCase.lastUpdated) : new Date(0);

            if (lastUpdated.getTime() >= CASE_SUMMARY_VERSION_DATE.getTime()) {
                // Cached summary is new enough for current version - use it
                await QueueClient.deleteMessage(receiptHandle, 'data');
                console.log(`Case ${caseNumber} already complete and up-to-date (lastUpdated=${zipCase.lastUpdated}); using cached data`);
                return zipCase.fetchStatus;
            }

            console.log(
                `Case ${caseNumber} lastUpdated (${zipCase.lastUpdated}) is older than version date ${CASE_SUMMARY_VERSION_DATE.toISOString()}; re-fetching case summary`
            );
        }

        // Fetch case summary
        const caseSummary = await fetchCaseSummary(caseId);

        // Update to complete status
        const completeStatus: FetchStatus = { status: 'complete' };
        await StorageClient.saveCase({
            caseNumber,
            caseId,
            fetchStatus: completeStatus,
            lastUpdated: new Date().toISOString(),
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

        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Unhandled error during case data retrieval', error as Error, {
            caseNumber,
            caseId,
            userId,
        });

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

async function fetchCaseIdFromPortal(caseNumber: string, cookieJar: CookieJar): Promise<CaseSearchResult> {
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

        const searchResponse = await client.post(`${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`, searchFormData);

        if (searchResponse.status !== 200) {
            const errorMessage = `Search request failed with status ${searchResponse.status}`;

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, 'Case search request failed', new Error(errorMessage), {
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
        if (resultsResponse.data.includes('Smart Search is having trouble processing your search')) {
            const errorMessage = 'Smart Search is having trouble processing your search. Please try again later.';

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, 'Smart Search processing error', new Error(errorMessage), {
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

        await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, 'Failed to fetch case ID from portal', error as Error, {
            caseNumber,
            resource: 'case-id-fetch',
        });

        return {
            caseId: null,
            error: {
                message: errorMessage,
                isSystemError: true,
            },
        };
    }
}

interface EndpointConfig {
    path: string;
}

const caseEndpoints: Record<string, EndpointConfig> = {
    summary: {
        path: 'Service/CaseSummariesSlim?key={caseId}',
    },
    charges: {
        path: "Service/Charges('{caseId}')",
    },
    dispositionEvents: {
        path: "Service/DispositionEvents('{caseId}')",
    },
    financialSummary: {
        path: "Service/FinancialSummary('{caseId}')",
    },
    caseEvents: {
        path: "Service/CaseEvents('{caseId}')?top=200",
    },
};

const ENDPOINT_FETCH_MAX_RETRIES = parseInt(process.env.ENDPOINT_FETCH_MAX_RETRIES || '3', 10);
const ENDPOINT_FETCH_RETRY_BASE_MS = parseInt(process.env.ENDPOINT_FETCH_RETRY_BASE_MS || '200', 10);

export async function fetchWithRetry(client: any, url: string, key: string) {
    let attempt = 0;

    while (attempt < ENDPOINT_FETCH_MAX_RETRIES) {
        attempt += 1;
        try {
            const response = await client.get(url);
            if (response.status === 200) {
                return { key, success: true, data: response.data };
            }

            // Non-200 responses: decide whether retryable (5xx)
            if (response.status >= 500 && attempt < ENDPOINT_FETCH_MAX_RETRIES) {
                const delayMs = ENDPOINT_FETCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.warn(
                    `Transient server error fetching ${key} (status ${response.status}), retrying in ${delayMs}ms (attempt ${attempt})`
                );
                await new Promise(res => setTimeout(res, delayMs));
                continue;
            }

            return { key, success: false, error: `${key} request failed with status ${response.status}` };
        } catch (error) {
            const err: any = error;

            // If axios returned a response, check its status
            const status = err?.response?.status;
            if (status && status >= 500 && attempt < ENDPOINT_FETCH_MAX_RETRIES) {
                const delayMs = ENDPOINT_FETCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.warn(`Transient server error fetching ${key} (status ${status}), retrying in ${delayMs}ms (attempt ${attempt})`);
                await new Promise(res => setTimeout(res, delayMs));
                continue;
            }

            // Network-level or timeout errors are considered retryable
            const isNetworkError =
                !err?.response || err?.code === 'ECONNABORTED' || err?.code === 'ENOTFOUND' || err?.code === 'ECONNRESET';
            if (isNetworkError && attempt < ENDPOINT_FETCH_MAX_RETRIES) {
                const delayMs = ENDPOINT_FETCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.warn(`Network error fetching ${key} (${err?.message}), retrying in ${delayMs}ms (attempt ${attempt})`);
                await new Promise(res => setTimeout(res, delayMs));
                continue;
            }

            // If this was a network error and we've exhausted attempts, return a standardized exhausted message
            if (isNetworkError && attempt >= ENDPOINT_FETCH_MAX_RETRIES) {
                return { key, success: false, error: `Failed to fetch ${key} after ${ENDPOINT_FETCH_MAX_RETRIES} attempts` };
            }

            // Not retryable or other error: return detailed error
            return { key, success: false, error: `Error fetching ${key}: ${err?.message || String(err)}` };
        }
    }

    return { key, success: false, error: `Failed to fetch ${key} after ${ENDPOINT_FETCH_MAX_RETRIES} attempts` };
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

        // First, collect all raw data from endpoints
        const rawData: Record<string, PortalApiResponse> = {};

        // Create an array of promises for all endpoint requests
        const endpointPromises = Object.entries(caseEndpoints).map(async ([key, endpoint]) => {
            try {
                const url = `${portalCaseUrl}${endpoint.path.replace('{caseId}', caseId)}`;
                console.log(`Fetching ${key} data from ${url}`);

                const fetchResult = await fetchWithRetry(client, url, key);

                if (!fetchResult.success) {
                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.PORTAL,
                        `Failed to fetch ${key}`,
                        new Error(fetchResult.error),
                        {
                            caseId,
                            resource: key,
                        }
                    );
                    return { key, success: false, error: fetchResult.error };
                }

                return { key, success: true, data: fetchResult.data };
            } catch (error) {
                await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, `Error fetching ${key}`, error as Error, {
                    caseId,
                    resource: key,
                });

                return {
                    key,
                    success: false,
                    error: `Error fetching ${key}: ${(error as Error).message}`,
                };
            }
        });

        // Wait for all promises to resolve
        const results = await Promise.all(endpointPromises);

        // Only the 'summary' endpoint is strictly required. Other endpoints are optional;
        // if they fail we'll proceed with partial data but still alert which endpoints failed.
        const summaryFailure = results.find(result => !result.success && result.key === 'summary');

        if (summaryFailure) {
            console.error(`Required endpoint ${summaryFailure.key} failed: ${summaryFailure.error}`);
            return null;
        }

        // Collect all raw data
        results.forEach(result => {
            if (result.success && result.data) {
                rawData[result.key] = result.data;
            }
        });

        // Now that we have all raw data, build the CaseSummary object
        return buildCaseSummary(rawData);
    } catch (error) {
        await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, 'Error fetching case summary', error as Error, {
            caseId,
            resource: 'case-summary',
        });
        return null;
    }
}

function buildCaseSummary(rawData: Record<string, PortalApiResponse>): CaseSummary | null {
    try {
        if (!rawData['summary']) {
            console.error('Missing required summary data for building case summary');
            return null;
        }

        // If other endpoints are missing, emit a warning but continue building a partial summary.
        if (!rawData['charges']) {
            console.warn('Charges data missing for case; building partial summary without charges');
        }
        if (!rawData['dispositionEvents']) {
            console.warn('Disposition events missing for case; building partial summary without dispositions');
        }

        const caseSummary: CaseSummary = {
            caseName: rawData['summary']['CaseSummaryHeader']['Style'] || '',
            court: rawData['summary']['CaseSummaryHeader']['Heading'] || '',
            charges: [],
            filingAgency: null,
        };

        const chargeMap = new Map<number, Charge>();

        // Process charges
        const charges = rawData['charges'] && rawData['charges']['Charges'] ? rawData['charges']['Charges'] : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        charges.forEach((chargeData: any) => {
            if (!chargeData) return;

            // The charge offense data is nested within the ChargeOffense property
            const chargeOffense = chargeData['ChargeOffense'] || {};

            const charge: Charge = {
                offenseDate: chargeData['OffenseDate'] || '',
                filedDate: chargeData['FiledDate'] || '',
                description: chargeOffense['ChargeOffenseDescription'] || '',
                statute: chargeOffense['Statute'] || '',
                degree: {
                    code: chargeOffense['Degree'] || '',
                    description: chargeOffense['DegreeDescription'] || '',
                },
                fine: typeof chargeOffense['FineAmount'] === 'number' ? chargeOffense['FineAmount'] : 0,
                dispositions: [],
                filingAgency: null,
                filingAgencyAddress: [],
            };

            const filingAgencyRaw = chargeData['FilingAgencyDescription'];
            if (filingAgencyRaw) {
                charge.filingAgency = String(filingAgencyRaw).trim();
            }

            // Extract filing agency address if present. It will be an array of strings.
            const filingAgencyAddressRaw = chargeData['FilingAgencyAddress'];
            if (filingAgencyAddressRaw) {
                charge.filingAgencyAddress.push(...(filingAgencyAddressRaw as any));
            }

            // Add to charges array
            caseSummary.charges.push(charge);

            // Add to map for easy lookup when processing dispositions
            if (chargeData['ChargeId'] != null) {
                chargeMap.set(chargeData['ChargeId'], charge);
            }
        });

        // After processing charges, derive top-level filing agency if appropriate
        try {
            const definedAgencies = caseSummary.charges.map(ch => ch.filingAgency).filter((a): a is string => a !== null && a.length > 0);

            const uniqueAgencies = Array.from(new Set(definedAgencies));

            // If there's at least one defined agency, and all defined agencies are identical,
            // set it on the case summary. Charges that lack an agency (null) are ignored for this decision.
            if (uniqueAgencies.length === 1 && uniqueAgencies[0]) {
                caseSummary.filingAgency = uniqueAgencies[0];
                console.log(`🔔 Set Filing Agency to ${caseSummary.filingAgency}`);
            }
        } catch (faErr) {
            console.error('Error computing top-level filing agency:', faErr);
        }

        // Process dispositions and link them to charges
        const dispositionEvents =
            rawData['dispositionEvents'] && rawData['dispositionEvents']['Events'] ? rawData['dispositionEvents']['Events'] : [];
        console.log(`📋 Found ${dispositionEvents.length} disposition events`);

        dispositionEvents
            .filter(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (eventData: any) => eventData && eventData['Type'] === 'CriminalDispositionEvent'
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .forEach((eventData: any) => {
                if (!eventData || !eventData['Event']) return;

                // CriminalDispositions are inside the Event property
                const dispositions = eventData['Event']['CriminalDispositions'] || [];
                console.log(`🔍 Processing disposition event with ${dispositions.length} dispositions`);

                // Alert if more than one disposition
                if (dispositions && dispositions.length > 1) {
                    AlertService.logError(
                        Severity.WARNING,
                        AlertCategory.PORTAL,
                        'Multiple dispositions found for a single event',
                        new Error('Unexpected multiple dispositions'),
                        {
                            caseId: rawData['summary']['CaseSummaryHeader']['CaseId'] || 'unknown',
                            eventId: eventData['EventId'] || 'unknown',
                        }
                    ).catch(err => console.error('Failed to log alert:', err));
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dispositions.forEach((disp: any) => {
                    if (!disp) return;

                    // Extract the event date from either the Event.Date or SortEventDate
                    const eventDate = eventData['Event']['Date'] || eventData['SortEventDate'] || '';

                    // The criminal disposition type information contains the code and description
                    const dispTypeId = disp['CriminalDispositionTypeId'] || {};

                    // Create the disposition object
                    const disposition: Disposition = {
                        date: eventDate,
                        code: dispTypeId['Word'] || '',
                        description: dispTypeId['Description'] || '',
                    };
                    console.log(`📝 Created disposition:`, disposition);

                    // The charge ID is in ChargeID (note the capitalization)
                    const chargeId = disp['ChargeID'];

                    // Find the matching charge and add the disposition
                    if (chargeId != null) {
                        const charge = chargeMap.get(chargeId);
                        if (charge) {
                            charge.dispositions.push(disposition);
                            console.log(
                                `✅ Successfully matched disposition "${disposition.description}" to charge "${charge.description}" via ChargeID: ${chargeId}`
                            );
                        } else {
                            console.log(
                                `❌ No matching charge found for disposition "${disposition.description}" with ChargeID: ${chargeId}. Available charge IDs: [${Array.from(chargeMap.keys()).join(', ')}]`
                            );
                        }
                    } else {
                        console.log(`⚠️ Missing ChargeID for disposition "${disposition.description}". ChargeID value:`, chargeId);
                    }
                });
            });

        // Process case-level events to determine arrest or citation date (LPSD -> Arrest, CIT -> Citation)
        try {
            const caseEvents = rawData['caseEvents']?.['Events'] || [];
            console.log(`📋 Found ${caseEvents.length} case events`);

            // Filter only events that have the LPSD (arrest) or CIT (citation) TypeId and a valid EventDate
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const candidateEvents = caseEvents.filter(
                (ev: any) => ev && ev['Event'] && ev['Event']['TypeId'] && ev['Event']['TypeId']['Word'] && ev['Event']['EventDate']
            );

            console.log(`🔎 Found ${candidateEvents.length} candidate events for arrest/citation`);

            if (candidateEvents.length > 0) {
                const parsedCandidates: { date: Date; type: 'Arrest' | 'Citation'; raw: string }[] = [];

                candidateEvents.forEach((ev: any, idx: number) => {
                    const typeWord = ev['Event']['TypeId']['Word'];
                    const eventDateStr = ev['Event']['EventDate'];

                    if (typeWord !== 'LPSD' && typeWord !== 'CIT') {
                        return;
                    }

                    const parsed = parseUsDate(eventDateStr);
                    if (parsed) {
                        parsedCandidates.push({
                            date: parsed,
                            type: typeWord === 'LPSD' ? 'Arrest' : 'Citation',
                            raw: eventDateStr,
                        });
                        console.log(`   ✔  Candidate #${idx}: Type=${typeWord}, Parsed=${parsed.toISOString()}`);
                    } else {
                        console.warn(`   ✖  Candidate #${idx} has unparseable date: ${eventDateStr}`);
                    }
                });

                if (parsedCandidates.length > 0) {
                    // Choose the earliest date among all matching candidates
                    const earliest = parsedCandidates.reduce(
                        (min, c) => (c.date.getTime() < min.date.getTime() ? c : min),
                        parsedCandidates[0]
                    );

                    caseSummary.arrestOrCitationDate = formatIsoDate(earliest.date);
                    caseSummary.arrestOrCitationType = earliest.type;
                    console.log(`🔔 Set ${earliest.type} date to ${caseSummary.arrestOrCitationDate}`);
                } else {
                    console.log('No parsable arrest/citation dates found among candidates');
                }
            }
        } catch (evtErr) {
            console.error('Error processing caseEvents for arrest/citation date:', evtErr);
        }

        return caseSummary;
    } catch (error) {
        AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Error building case summary from raw data', error as Error, {
            caseId: rawData['summary']['CaseSummaryHeader']['CaseId'] || 'unknown',
        });

        return null;
    }
}

const CaseProcessor = {
    processCaseSearch,
    processCaseData,
    queueCasesForSearch,
    fetchCaseIdFromPortal,
    buildCaseSummary,
};

export default CaseProcessor;
