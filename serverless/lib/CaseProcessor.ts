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
import * as cheerio from 'cheerio';

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
const processCaseData: SQSHandler = async (event: SQSEvent) => {
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
        // Check for existing data and skip if already complete
        const zipCase = await StorageClient.getCase(caseNumber);
        if (zipCase && zipCase.fetchStatus.status === 'complete') {
            // Always use the cached data for complete cases
            await QueueClient.deleteMessage(receiptHandle, 'data');
            console.log(
                `Case ${caseNumber} already complete; using cached data and deleted queue item`
            );
            return zipCase.fetchStatus;
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
};

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
        const rawData: Record<string, any> = {};

        // Create an array of promises for all endpoint requests
        const endpointPromises = Object.entries(caseEndpoints).map(async ([key, endpoint]) => {
            try {
                const url = `${portalCaseUrl}${endpoint.path.replace('{caseId}', caseId)}`;
                console.log(`Fetching ${key} data from ${url}`);

                const response = await client.get(url);

                if (response.status !== 200) {
                    const errorMessage = `${key} request failed with status ${response.status}`;
                    console.error(errorMessage);

                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.PORTAL,
                        `Failed to fetch ${key}`,
                        new Error(errorMessage),
                        {
                            caseId,
                            statusCode: response.status,
                            resource: key,
                        }
                    );

                    return { key, success: false, error: errorMessage };
                }

                // Just store the raw response data
                return { key, success: true, data: response.data };
            } catch (error) {
                const errorMessage = `Error fetching ${key}: ${(error as Error).message}`;
                console.error(errorMessage);

                await AlertService.logError(
                    Severity.ERROR,
                    AlertCategory.PORTAL,
                    `Error fetching ${key}`,
                    error as Error,
                    {
                        caseId,
                        resource: key,
                    }
                );

                return { key, success: false, error: errorMessage };
            }
        });

        // Wait for all promises to resolve
        const results = await Promise.all(endpointPromises);

        // Check if any endpoint failed
        const requiredFailure = results.find(result => !result.success);

        if (requiredFailure) {
            console.error(`Required endpoint ${requiredFailure.key} failed: ${requiredFailure.error}`);
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

function buildCaseSummary(rawData: Record<string, any>): CaseSummary | null {
    try {
        if (!rawData['summary'] || !rawData['charges'] || !rawData['dispositionEvents']) {
            console.error('Missing required raw data for building case summary');
            return null;
        }

        const caseSummary: CaseSummary = {
            caseName: rawData['summary']['CaseSummaryHeader']['Style'] || '',
            court: rawData['summary']['CaseSummaryHeader']['Heading'] || '',
            charges: []
        };

        const chargeMap = new Map<string, Charge>();

        // Process charges
        const charges = rawData['charges']['Charges'] || [];
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
                    description: chargeOffense['DegreeDescription'] || ''
                },
                fine: typeof chargeOffense['FineAmount'] === 'number' ? chargeOffense['FineAmount'] : 0,
                dispositions: []
            };

            // Add to charges array
            caseSummary.charges.push(charge);

            // Add to map for easy lookup when processing dispositions
            if (chargeData['ChargeId']) {
                chargeMap.set(chargeData['ChargeId'], charge);
            }
        });

        // Process dispositions and link them to charges
        const events = rawData['dispositionEvents']['Events'] || [];
        events.filter((eventData: any) => eventData && eventData['Type'] === 'CriminalDispositionEvent')
            .forEach((eventData: any) => {
                if (!eventData || !eventData['Event']) return;

                // CriminalDispositions are inside the Event property
                const dispositions = eventData['Event']['CriminalDispositions'] || [];

                // Alert if more than one disposition
                if (dispositions && dispositions.length > 1) {
                    AlertService.logError(
                        Severity.WARNING,
                        AlertCategory.PORTAL,
                        'Multiple dispositions found for a single event',
                        new Error('Unexpected multiple dispositions'),
                        {
                            caseId: rawData['summary']['CaseSummaryHeader']['CaseId'] || 'unknown',
                            eventId: eventData['EventId'] || 'unknown'
                        }
                    ).catch(err => console.error('Failed to log alert:', err));
                }

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
                        description: dispTypeId['Description'] || ''
                    };

                    // The charge ID is in ChargeID (note the capitalization)
                    const chargeId = disp['ChargeID'];

                    // Find the matching charge and add the disposition
                    if (chargeId) {
                        const charge = chargeMap.get(chargeId);
                        if (charge) {
                            charge.dispositions.push(disposition);
                        }
                    }
                });
        });

        return caseSummary;
    } catch (error) {
        console.error('Error building case summary:', error);
        AlertService.logError(
            Severity.ERROR,
            AlertCategory.SYSTEM,
            'Error building case summary from raw data',
            error as Error,
            {
            caseId: rawData.summary?.CaseSummaryHeader?.CaseId || 'unknown'
            }
        ).catch(err => console.error('Failed to log alert:', err));
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
