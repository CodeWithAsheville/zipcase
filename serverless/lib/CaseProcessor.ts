import { SQSHandler, SQSEvent } from 'aws-lambda';
import QueueClient from './QueueClient';
import StorageClient from './StorageClient';
import UserAgentClient from './UserAgentClient';
import AlertService, { Severity, AlertCategory } from './AlertService';
import PortalAuthenticator from './PortalAuthenticator';
import PortalRequestClient from './PortalRequestClient';
import { CaseSummary, Charge, Disposition, FetchStatus } from '../../shared/types';
import WebSocketPublisher from './WebSocketPublisher';
import { AxiosResponse } from 'axios';
import { parseUsDate, formatIsoDate } from '../../shared/DateTimeUtils';

// Version date used to determine whether a cached 'complete' CaseSummary is
// up-to-date or should be re-fetched to align with current schema/logic.
export const CASE_SUMMARY_VERSION_DATE = new Date('2025-10-08T14:00:00Z');

// Type for raw portal JSON data - using `any` is acceptable here since we're dealing with
// dynamic external API responses that we don't control
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PortalApiResponse = any;

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
        const caseSummary = await fetchCaseSummary(caseId, userId);

        if (!caseSummary) {
            const message = `Failed to fetch required case summary data for case ${caseNumber}`;
            const failedAt = new Date().toISOString();
            const failedStatus: FetchStatus = { status: 'failed', message };

            await StorageClient.saveCase({
                caseNumber,
                caseId,
                fetchStatus: failedStatus,
                lastUpdated: failedAt,
            });

            await WebSocketPublisher.publishCaseStatusUpdated(userId, caseNumber, {
                zipCase: {
                    caseNumber,
                    caseId,
                    fetchStatus: failedStatus,
                    lastUpdated: failedAt,
                },
            });

            await QueueClient.deleteMessage(receiptHandle, 'data');
            return failedStatus;
        }

        const completedAt = new Date().toISOString();

        // Update to complete status
        const completeStatus: FetchStatus = { status: 'complete' };
        await StorageClient.saveCase({
            caseNumber,
            caseId,
            fetchStatus: completeStatus,
            lastUpdated: completedAt,
        });

        // Save the case summary if available
        await StorageClient.saveCaseSummary(caseNumber, caseSummary);

        await WebSocketPublisher.publishCaseStatusUpdated(userId, caseNumber, {
            zipCase: {
                caseNumber,
                caseId,
                fetchStatus: completeStatus,
                lastUpdated: completedAt,
            },
            caseSummary,
        });

        // Delete the data queue item
        await QueueClient.deleteMessage(receiptHandle, 'data');
        console.log(`Successfully completed data retrieval for case ${caseNumber}`);

        return completeStatus;
    } catch (error) {
        const message = `Unhandled error while retrieving data for case ${caseNumber}: ${(error as Error).message}`;
        const failedAt = new Date().toISOString();

        try {
            await StorageClient.saveCase({
                caseNumber,
                caseId,
                fetchStatus: { status: 'failed', message },
                lastUpdated: failedAt,
            });

            await WebSocketPublisher.publishCaseStatusUpdated(userId, caseNumber, {
                zipCase: {
                    caseNumber,
                    caseId,
                    fetchStatus: { status: 'failed', message },
                    lastUpdated: failedAt,
                },
            });
        } catch (publishError) {
            console.error('Failed to persist/publish case data failure status:', publishError);
        }

        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Unhandled error during case data retrieval', error as Error, {
            caseNumber,
            caseId,
            userId,
        });

        return { status: 'failed', message };
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

const CASE_DATA_ACCEPT_HEADER = 'application/json, text/plain, */*';

function getCaseDataRequestHeaders(userAgent: string, portalCaseUrl: string): Record<string, string> {
    return {
        'User-Agent': userAgent,
        Accept: CASE_DATA_ACCEPT_HEADER,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: portalCaseUrl,
        Origin: new URL(portalCaseUrl).origin,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
    };
}

function getErrorDetails(error: unknown): {
    message?: string;
    code?: string;
    response?: {
        status?: number;
        headers?: unknown;
    };
} {
    if (!error || typeof error !== 'object') {
        return {};
    }

    const candidate = error as {
        message?: unknown;
        code?: unknown;
        response?: {
            status?: unknown;
            headers?: unknown;
        };
    };

    return {
        message: typeof candidate.message === 'string' ? candidate.message : undefined,
        code: typeof candidate.code === 'string' ? candidate.code : undefined,
        response: candidate.response
            ? {
                  status: typeof candidate.response.status === 'number' ? candidate.response.status : undefined,
                  headers: candidate.response.headers,
              }
            : undefined,
    };
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value === null || typeof value === 'undefined') {
        return '';
    }

    return String(value);
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

async function createCaseDataClient(options: { userId: string; userAgent?: string }): Promise<{
    client: PortalRequestClient;
    portalCaseUrl: string;
    userAgent: string;
}> {
    const portalBaseUrl = process.env.PORTAL_URL;
    const portalCaseUrl = process.env.PORTAL_CASE_URL;

    if (!portalBaseUrl) {
        throw new Error('PORTAL_URL environment variable is not set');
    }

    if (!portalCaseUrl) {
        throw new Error('PORTAL_CASE_URL environment variable is not set');
    }

    const authResult = await PortalAuthenticator.getOrCreateUserSession(options.userId, options.userAgent);
    if (!authResult.success || !authResult.cookieJar) {
        throw new Error(authResult.message || 'Failed to acquire portal session for case data fetch');
    }

    const userAgent = await UserAgentClient.getUserAgent(options.userId, options.userAgent);

    const client = new PortalRequestClient({
        jar: authResult.cookieJar,
        portalUrl: portalBaseUrl,
        userAgent,
        timeout: 10000,
        defaultHeaders: getCaseDataRequestHeaders(userAgent, portalCaseUrl),
    });

    return {
        client,
        portalCaseUrl,
        userAgent,
    };
}

const ENDPOINT_FETCH_MAX_RETRIES = parseInt(process.env.ENDPOINT_FETCH_MAX_RETRIES || '3', 10);
const ENDPOINT_FETCH_RETRY_BASE_MS = parseInt(process.env.ENDPOINT_FETCH_RETRY_BASE_MS || '200', 10);

type CaseDataHttpClient = {
    get(url: string): Promise<AxiosResponse<string | PortalApiResponse>>;
};

export async function fetchWithRetry(client: CaseDataHttpClient, url: string, key: string) {
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
            const err = getErrorDetails(error);

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

async function fetchCaseSummary(caseId: string, userId: string): Promise<CaseSummary | null> {
    try {
        const { client, portalCaseUrl } = await createCaseDataClient({ userId });

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

        // First, collect all raw data from endpoints
        const rawData: Record<string, PortalApiResponse> = {};

        // Create an array of promises for all endpoint requests
        const endpointPromises = Object.entries(caseEndpoints).map(async ([key, endpoint]) => {
            try {
                const url = `${portalCaseUrl}${endpoint.path.replace('{caseId}', caseId)}`;

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

export function buildCaseSummary(rawData: Record<string, PortalApiResponse>): CaseSummary | null {
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
        const charges: unknown[] = Array.isArray(rawData['charges']?.['Charges']) ? rawData['charges']['Charges'] : [];
        charges.forEach((chargeValue: unknown) => {
            const chargeData = asObjectRecord(chargeValue);
            if (!chargeData) return;

            // The charge offense data is nested within the ChargeOffense property
            const chargeOffense = asObjectRecord(chargeData['ChargeOffense']) || {};

            const charge: Charge = {
                offenseDate: asString(chargeData['OffenseDate']),
                filedDate: asString(chargeData['FiledDate']),
                description: asString(chargeOffense['ChargeOffenseDescription']),
                statute: asString(chargeOffense['Statute']),
                degree: {
                    code: asString(chargeOffense['Degree']),
                    description: asString(chargeOffense['DegreeDescription']),
                },
                fine: asNumber(chargeOffense['FineAmount']) ?? 0,
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
            if (Array.isArray(filingAgencyAddressRaw)) {
                charge.filingAgencyAddress.push(...filingAgencyAddressRaw.map(item => String(item)));
            }

            // Add to charges array
            caseSummary.charges.push(charge);

            // Add to map for easy lookup when processing dispositions
            const chargeId = asNumber(chargeData['ChargeId']);
            if (chargeId !== null) {
                chargeMap.set(chargeId, charge);
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
        const dispositionEvents: unknown[] = Array.isArray(rawData['dispositionEvents']?.['Events'])
            ? rawData['dispositionEvents']['Events']
            : [];
        console.log(`📋 Found ${dispositionEvents.length} disposition events`);

        dispositionEvents
            .map(asObjectRecord)
            .filter((eventData: Record<string, unknown> | null): eventData is Record<string, unknown> => {
                return !!eventData && eventData['Type'] === 'CriminalDispositionEvent';
            })
            .forEach((eventData: Record<string, unknown>) => {
                const event = asObjectRecord(eventData['Event']);
                if (!event) return;

                // CriminalDispositions are inside the Event property
                const dispositions = asArray(event['CriminalDispositions']);
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

                dispositions.forEach((dispositionValue: unknown) => {
                    const disp = asObjectRecord(dispositionValue);
                    if (!disp) return;

                    // Extract the event date from either the Event.Date or SortEventDate
                    const eventDate = String(event['Date'] || eventData['SortEventDate'] || '');

                    // The criminal disposition type information contains the code and description
                    const dispTypeId = asObjectRecord(disp['CriminalDispositionTypeId']) || {};

                    // Create the disposition object
                    const disposition: Disposition = {
                        date: eventDate,
                        code: asString(dispTypeId['Word']),
                        description: asString(dispTypeId['Description']),
                    };
                    console.log(`📝 Created disposition:`, disposition);

                    // The charge ID is in ChargeID (note the capitalization)
                    const chargeId = asNumber(disp['ChargeID']);

                    // Find the matching charge and add the disposition
                    if (chargeId !== null) {
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
            const caseEvents: unknown[] = Array.isArray(rawData['caseEvents']?.['Events']) ? rawData['caseEvents']['Events'] : [];
            console.log(`📋 Found ${caseEvents.length} case events`);

            // Filter only events that have the LPSD (arrest) or CIT (citation) TypeId and a valid EventDate
            const candidateEvents = caseEvents.filter((eventValue: unknown) => {
                const eventWrapper = asObjectRecord(eventValue);
                const event = asObjectRecord(eventWrapper?.['Event']);
                const typeId = asObjectRecord(event?.['TypeId']);

                return !!event && !!typeId?.['Word'] && !!event['EventDate'];
            });

            console.log(`🔎 Found ${candidateEvents.length} candidate events for arrest/citation`);

            if (candidateEvents.length > 0) {
                const parsedCandidates: { date: Date; type: 'Arrest' | 'Citation'; raw: string }[] = [];

                candidateEvents.forEach((eventValue: unknown, idx: number) => {
                    const eventWrapper = asObjectRecord(eventValue);
                    const event = asObjectRecord(eventWrapper?.['Event']);
                    const typeId = asObjectRecord(event?.['TypeId']);
                    const typeWord = typeof typeId?.['Word'] === 'string' ? typeId['Word'] : '';
                    const eventDateStr = typeof event?.['EventDate'] === 'string' ? event['EventDate'] : '';

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
    processCaseData,
};

export default CaseProcessor;
