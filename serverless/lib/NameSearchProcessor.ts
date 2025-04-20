import { v4 as uuidv4 } from 'uuid';
import { NameSearchRequest, NameSearchResponse, NameSearchData } from '../../shared/types/Search';
import StorageClient from './StorageClient';
import NameParser from './NameParser';
import QueueClient from './QueueClient';
import PortalAuthenticator, { PortalAuthResult } from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { SQSHandler, SQSEvent } from 'aws-lambda';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import UserAgentClient from './UserAgentClient';

export async function processNameSearchRequest(
    req: NameSearchRequest,
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

        let userSession: PortalAuthResult | null = null;
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
        await QueueClient.queueNameSearchForProcessing(
            searchId,
            userId,
            req.name,
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

// Process the name search queue
export const processNameSearch: SQSHandler = async (event: SQSEvent) => {
    console.log(`Received ${event.Records.length} name search messages`);

    // Create specialized logger for name search
    const nameSearchLogger = AlertService.forCategory(AlertCategory.SYSTEM);

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { searchId, name, dateOfBirth, soundsLike, userId, userAgent } = messageBody;

            if (!searchId || !name || !userId) {
                await nameSearchLogger.error(
                    'Invalid name search message format, missing required fields',
                    undefined,
                    { searchId, name, userId, messageId: record.messageId }
                );
                continue;
            }

            console.log(`Processing name search ${searchId} for user ${userId}`);
            await processNameSearchRecord(
                searchId,
                name,
                userId,
                record.receiptHandle,
                dateOfBirth,
                soundsLike,
                userAgent
            );
        } catch (error) {
            await nameSearchLogger.error('Failed to process name search record', error as Error, {
                messageId: record.messageId,
            });
        }
    }
};

async function processNameSearchRecord(
    searchId: string,
    name: string,
    userId: string,
    receiptHandle: string,
    dateOfBirth?: string,
    soundsLike: boolean = false,
    userAgent?: string
): Promise<void> {
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

            await AlertService.logError(
                message.includes('Invalid Email or password') ? Severity.ERROR : Severity.CRITICAL,
                AlertCategory.AUTHENTICATION,
                'Portal authentication failed during name search',
                undefined,
                {
                    userId,
                    searchId,
                    message,
                }
            );

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
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Name search failed with error',
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
        const errorMsg = `Unhandled error processing name search ${searchId}: ${(error as Error).message}`;
        console.error(errorMsg);

        await AlertService.logError(
            Severity.ERROR,
            AlertCategory.SYSTEM,
            'Unhandled error during name search processing',
            error as Error,
            { searchId, name, userId }
        );

        const nameSearch = await StorageClient.getNameSearch(searchId);
        if (nameSearch) {
            await StorageClient.saveNameSearch(searchId, {
                ...nameSearch,
                status: 'failed',
                message: `Error: ${(error as Error).message}`,
            });
        }
    }
}

interface NameSearchResult {
    caseNumbers: string[];
    error?: string;
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

export default {
    processNameSearchRequest,
    getNameSearchResults,
    processNameSearch,
};
