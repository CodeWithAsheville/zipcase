import { v4 as uuidv4 } from 'uuid';
import { NameSearchResponse, NameSearchData } from '../../shared/types';
import StorageClient from './StorageClient';
import NameParser from './NameParser';
import QueueClient from './QueueClient';
import PortalAuthenticator from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import UserAgentClient from './UserAgentClient';

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

// Name search result interface
interface NameSearchResult {
    cases: { caseId: string; caseNumber: string }[];
    error?: string;
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

// Fetch cases by name from the portal
export async function fetchCasesByName(
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
                cases: [] as { caseId: string; caseNumber: string }[],
                error: 'Portal URL environment variable is not set',
            };
        }

        const userAgent = await UserAgentClient.getUserAgent('system');

        const client = wrapper(axios).create({
            timeout: 20000,
            maxRedirects: 0,
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

        console.log("Posting smart search");

        // Log request details before sending
        console.log('SMART SEARCH REQUEST DETAILS:');
        console.log(`URL: ${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`);
        console.log('Headers:');
        console.log(JSON.stringify(client.defaults.headers, null, 2));
        console.log('Form Data:');
        console.log(Object.fromEntries(searchFormData.entries()));

        // Step 1a: Make initial POST request and handle the 302
        try {
            const initialResponse = await client.post(
                `${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`,
                searchFormData
            );

            console.log(`Initial response status: ${initialResponse.status}`);

            // Log ALL headers from the initial 302 response
            console.log('ALL HEADERS from 302 response:');
            console.log(JSON.stringify(initialResponse.headers, null, 2));

            // Parse and log specific important headers
            if (initialResponse.headers) {
                console.log('\nImportant headers breakdown:');
                if (initialResponse.headers.location) {
                    console.log(`Location: ${initialResponse.headers.location}`);
                }
                if (initialResponse.headers['set-cookie']) {
                    console.log('Set-Cookie headers:');
                    console.log(JSON.stringify(initialResponse.headers['set-cookie'], null, 2));

                    // Ensure the SmartSearchCriteria cookie is in the jar
                    const setCookieHeaders = initialResponse.headers['set-cookie'];
                    if (Array.isArray(setCookieHeaders)) {
                        const smartSearchCookie = setCookieHeaders.find(c => c.includes('SmartSearchCriteria='));
                        if (smartSearchCookie) {
                            console.log(`Found SmartSearchCriteria in redirect: ${smartSearchCookie}`);
                        }
                    }
                }
            }

            // After the 302 response, follow the redirect location from the header
            if (initialResponse.status === 302) {
                // Check if we have a location header
                if (!initialResponse.headers.location) {
                    console.error('302 received but no location header found');
                    throw new Error('302 redirect without location header');
                }

                // Get the redirect URL from the location header
                const redirectLocation = initialResponse.headers.location;
                let redirectUrl = redirectLocation;

                // If the location is not an absolute URL, construct it using the base portal URL
                if (!redirectLocation.startsWith('http')) {
                    redirectUrl = new URL(redirectLocation, portalUrl).toString();
                }

                console.log(`302 received. Following redirect to location: ${redirectUrl}`);

                // Log all request details for redirect request
                console.log('REDIRECT NAVIGATION REQUEST DETAILS:');
                console.log(`URL: ${redirectUrl}`);
                console.log('Headers:');
                console.log(JSON.stringify(client.defaults.headers, null, 2));

                // Log cookies being sent with this request
                const preCookies = cookieJar.getCookiesSync(`${portalUrl}/Portal`);
                console.log(`Cookies being sent with redirect (${preCookies.length}):`);
                preCookies.forEach(cookie => {
                    console.log(`- ${cookie.key}=${cookie.value}`);
                });

                const redirectResponse = await client.get(redirectUrl);
                console.log(`Redirect response status: ${redirectResponse.status}`);
                console.log(`Redirect response URL: ${redirectUrl}`);

                // Log full response body preview (first 500 chars)
                if (redirectResponse.data) {
                    const responseText = typeof redirectResponse.data === 'string'
                        ? redirectResponse.data
                        : JSON.stringify(redirectResponse.data);
                    console.log('Redirect response preview:');
                    console.log(responseText.substring(0, 500) + '...');
                }

                // Log any cookies or headers from this response
                if (redirectResponse.headers) {
                    console.log('Redirect response headers:');
                    console.log(JSON.stringify(redirectResponse.headers, null, 2));

                    if (redirectResponse.headers['set-cookie']) {
                        console.log('Found Set-Cookie headers in redirect response:');
                        console.log(JSON.stringify(redirectResponse.headers['set-cookie'], null, 2));
                    }
                }

                // Log cookies in jar after redirect request
                const redirectCookies = cookieJar.getCookiesSync(`${portalUrl}/Portal`);
                console.log(`Cookie jar after redirect request contains ${redirectCookies.length} cookies:`);
                redirectCookies.forEach(cookie => {
                    console.log(`- ${cookie.key}=${cookie.value} (domain=${cookie.domain}, path=${cookie.path})`);
                });

                // Continue with normal flow using the redirect response
                if (redirectResponse.status !== 200) {
                    const errorMessage = `Redirect request failed with status ${redirectResponse.status}`;

                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.PORTAL,
                        'Name search redirect navigation failed',
                        new Error(errorMessage),
                        {
                            name,
                            statusCode: redirectResponse.status,
                            resource: 'portal-redirect-navigation',
                        }
                    );

                    return {
                        cases: [],
                        error: errorMessage,
                    };
                }
            } else if (initialResponse.status !== 200) {
                // Handle non-redirect error
                const errorMessage = `Search request failed with status ${initialResponse.status}`;

                await AlertService.logError(
                    Severity.ERROR,
                    AlertCategory.PORTAL,
                    'Name search request failed',
                    new Error(errorMessage),
                    {
                        name,
                        statusCode: initialResponse.status,
                        resource: 'portal-search',
                    }
                );

                return {
                    cases: [],
                    error: errorMessage,
                };
            }
        } catch (redirectError) {
            console.error("Error during smart search with redirect handling:", redirectError);
            const errorMessage = `Search request error: ${(redirectError as Error).message}`;

            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Name search request failed with exception',
                redirectError as Error,
                { name, resource: 'portal-search' }
            );

            return {
                cases: [],
                error: errorMessage,
            };
        }

        // Check if cookies were actually added to the jar after redirect handling
        const cookies = cookieJar.getCookiesSync(`${portalUrl}/Portal`);
        console.log(`Cookie jar after SmartSearch request contains ${cookies.length} cookies:`);
        cookies.forEach(cookie => {
            console.log(`- ${cookie.key}=${cookie.value} (domain=${cookie.domain}, path=${cookie.path})`);
        });

        // Check specifically for SmartSearchCriteria cookie
        const hasSmartSearchCookie = cookies.some(c => c.key === 'SmartSearchCriteria');
        console.log(`Has SmartSearchCriteria cookie: ${hasSmartSearchCookie}`);

        // Step 2: Get the search results page
        console.log("Getting smart search results");

        // Look specifically for SmartSearchCriteria cookie as it's essential
        const smartSearchCriteriaCookie = cookies.find(c => c.key === 'SmartSearchCriteria');
        if (smartSearchCriteriaCookie) {
            console.log(`Found SmartSearchCriteria in jar: ${smartSearchCriteriaCookie.key}=${smartSearchCriteriaCookie.value}`);
        } else {
            console.warn('WARNING: SmartSearchCriteria cookie not found in cookie jar!');
        }

        // Set up headers for the results request
        const resultsRequestHeaders: Record<string, string> = {
            'Referer': `${portalUrl}/Portal/Home/WorkspaceMode?p=0`,  // Important to set proper referer
        };

        // Log full request details for SmartSearchResults request
        console.log('SMART SEARCH RESULTS REQUEST DETAILS:');
        console.log(`URL: ${portalUrl}/Portal/SmartSearch/SmartSearchResults`);
        console.log('Headers to be sent:');
        console.log(JSON.stringify({
            ...client.defaults.headers,
            ...resultsRequestHeaders
        }, null, 2));

        // Log all cookies that will be sent with this request
        const resultsCookies = cookieJar.getCookiesSync(`${portalUrl}/Portal`);
        console.log(`Cookies being sent to SmartSearchResults (${resultsCookies.length}):`);
        resultsCookies.forEach(cookie => {
            console.log(`- ${cookie.key}=${cookie.value}`);
        });

        // Continue with the rest of the flow using the same client (with updated cookie jar)
        const resultsResponse = await client.get(
            `${portalUrl}/Portal/SmartSearch/SmartSearchResults`,
            { headers: resultsRequestHeaders }
        );

        console.log(`SmartSearchResults response status: ${resultsResponse.status}`);
        if (resultsResponse.headers) {
            console.log('SmartSearchResults headers:');
            console.log(JSON.stringify(resultsResponse.headers, null, 2));
        }

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
                cases: [],
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
                cases: [],
                error: errorMessage,
            };
        }

        // Step 3: Extract case data from the response
        const htmlContent = resultsResponse.data;

        // Extract case numbers and IDs from kendoGrid JSON structure
        const cases: { caseId: string; caseNumber: string }[] = []; // Array of case objects that will be returned
        const caseNumberSet = new Set<string>(); // For deduplication

        try {
            // Log the content type of the response
            console.log(`SmartSearchResults response content length: ${htmlContent.length} bytes`);

            // Check if the response is HTML and contains expected elements
            const isHtml = htmlContent.includes('<!DOCTYPE html>') || htmlContent.includes('<html');
            const hasGrid = htmlContent.includes('id="Grid"');
            console.log(`Response appears to be HTML: ${isHtml}, Contains Grid element: ${hasGrid}`);

            // Find the kendoGrid initialization with JSON data
            const kendoGridMatch = htmlContent.match(/jQuery\("#Grid"\)\.kendoGrid\((.*?)\);/s);
            console.log(`KendoGrid initialization ${kendoGridMatch ? 'found' : 'NOT found'} in response`);

            if (kendoGridMatch && kendoGridMatch[1]) {
                // Extract the raw JSON text for debugging
                const gridDataText = kendoGridMatch[1].trim();

                // Add more detailed logging to understand the JSON structure
                console.log('Found kendo grid initialization. First 100 chars:');
                console.log(gridDataText.substring(0, 100) + '...');

                let gridJson;

                try {
                    // Extract just the data section we need using a specific pattern
                    console.log('Extracting just the data section using pattern...');

                    // Look for the pattern "data":{"Data": ... "Total":<number>}}
                    // This captures the property name 'data' AND its value
                    const dataMatch = gridDataText.match(/"data":\{"Data":.*?"Total":\d+\}\}/s);

                    if (dataMatch && dataMatch[0]) {
                        // Include the property name "data" in our extracted JSON
                        const dataSection = `{${dataMatch[0]}`;
                        console.log(`Found data section (${dataSection.length} chars), parsing as JSON...`);
                        console.log('Data section preview:');
                        console.log(dataSection.substring(0, 100) + '...');

                        // Parse the complete JSON object with the data property
                        try {
                            gridJson = JSON.parse(dataSection);
                            console.log('Data section parsed successfully as complete object');
                        } catch (innerError) {
                            console.log('Failed to parse with complete wrapper, trying to clean the data section...');

                            // Try fixing any JSON format issues before parsing
                            let fixedDataSection = dataSection
                                .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas

                            gridJson = JSON.parse(fixedDataSection);
                            console.log('Data section parsed successfully after cleaning');
                        }
                    } else {
                        console.log('Could not find data section with specified pattern, falling back to full parsing');

                        // Handle window.odyPortal references and other function references as fallback
                        let cleanedGridDataText = gridDataText
                            // Replace function references and JavaScript expressions with string placeholders
                            .replace(/window\.odyPortal\.[^,}]+/g, '"__FUNCTION_PLACEHOLDER__"')
                            .replace(/function\s*\([^)]*\)\s*{[^}]*}/g, '"__FUNCTION_PLACEHOLDER__"')
                            // Handle any other JavaScript expressions that aren't valid JSON
                            .replace(/:\s*([^",{\[\s][^,}\]]*)/g, ':"$1"');

                        console.log('Cleaned first 100 chars:');
                        console.log(cleanedGridDataText.substring(0, 100) + '...');

                        // Convert text to valid JSON and parse it
                        console.log('Attempting to parse full JSON as fallback...');
                        gridJson = JSON.parse(`{${cleanedGridDataText}}`);
                        console.log('Full JSON parsed successfully as fallback');
                    }

                    if (gridJson && gridJson.data && gridJson.data.Data && Array.isArray(gridJson.data.Data)) {
                        console.log(`Found ${gridJson.data.Data.length} data entries in grid`);
                    }
                } catch (parseError) {
                    console.error('JSON parsing error:', parseError);
                    console.log('First 100 chars of gridDataText:');
                    console.log(gridDataText.substring(0, 100));
                    console.log('Last 100 chars of gridDataText:');
                    console.log(gridDataText.substring(gridDataText.length - 100));

                    // Try to fix common JSON parsing issues
                    console.log('Attempting to fix JSON format before parsing...');
                    let fixedGridDataText = gridDataText.trim();

                    // Remove any trailing commas that could cause parsing issues
                    fixedGridDataText = fixedGridDataText.replace(/,\s*([}\]])/g, '$1');

                    // Try parsing with the fixed text
                    try {
                        gridJson = JSON.parse(`{${fixedGridDataText}}`);
                        console.log('JSON parsed successfully after fixing format');

                        if (gridJson && gridJson.data && gridJson.data.Data && Array.isArray(gridJson.data.Data)) {
                            console.log(`Found ${gridJson.data.Data.length} data entries in grid after fixing format`);
                        }
                    } catch (fixError) {
                        console.error('Still failed to parse JSON after fixes:', fixError);
                        throw fixError; // Re-throw to be caught by the outer catch block
                    }
                }

                // If we have valid grid data, process it
                if (gridJson && gridJson.data && gridJson.data.Data && Array.isArray(gridJson.data.Data)) {
                    // Loop through each party in the Data array
                    for (const party of gridJson.data.Data) {
                        // Process CaseResults for this party if they exist
                        if (party.CaseResults && Array.isArray(party.CaseResults)) {
                            for (const caseResult of party.CaseResults) {
                                if (caseResult.EncryptedCaseId && caseResult.CaseNumber) {
                                    // Only add if we haven't seen this case number before
                                    if (!caseNumberSet.has(caseResult.CaseNumber)) {
                                        cases.push({
                                            caseId: caseResult.EncryptedCaseId,
                                            caseNumber: caseResult.CaseNumber
                                        });
                                        caseNumberSet.add(caseResult.CaseNumber);
                                        console.log(`Found case: ${caseResult.CaseNumber}, ID: ${caseResult.EncryptedCaseId}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            console.log(`Found ${cases.length} unique case entries`);
            if (cases.length > 0) {
                console.log(`Case data: ${JSON.stringify(cases)}`);
            }

            // Return array of objects with both caseId and caseNumber
            return {
                cases,
                error: undefined
            };

        } catch (jsonError) {
            console.error('Error parsing kendoGrid JSON data:', jsonError);

            // Log the HTML content for debugging when kendoGrid JSON is not found
            console.log('HTML Response Content Preview:');
            // Log just the first 500 characters to avoid excessive logging
            console.log(htmlContent.substring(0, 500) + (htmlContent.length > 500 ? '...' : ''));

            // Look for specific error messages in the HTML content
            const errorMessages = [
                'Smart Search is having trouble',
                'An error has occurred',
                'server error',
                'not found',
                'access denied',
                'unauthorized'
            ];

            for (const errorText of errorMessages) {
                if (htmlContent.toLowerCase().includes(errorText.toLowerCase())) {
                    console.log(`Found error text in response: "${errorText}"`);
                }
            }

            // Try a different regex pattern that might be more forgiving
            console.log('Attempting alternative parsing methods...');
            try {
                // Method 1: Try to extract just the data section
                console.log('Method 1: Extracting only the data property...');
                const dataMatch = htmlContent.match(/data\s*:\s*(\{[^}]*"Data"\s*:\s*\[.*?\]\s*\})/s);
                if (dataMatch && dataMatch[1]) {
                    console.log('Found data section, attempting to parse...');
                    const dataJson = JSON.parse(dataMatch[1].replace(/([{,])\s*([^"'\s][^:]*?):\s*/g, '$1"$2":'));

                    if (dataJson && dataJson.Data && Array.isArray(dataJson.Data)) {
                        console.log(`Found ${dataJson.Data.length} data entries using data extraction method`);

                        // Process the data section directly
                        const dataCases = [];
                        for (const party of dataJson.Data) {
                            if (party.CaseResults && Array.isArray(party.CaseResults)) {
                                for (const caseResult of party.CaseResults) {
                                    if (caseResult.EncryptedCaseId && caseResult.CaseNumber &&
                                        !caseNumberSet.has(caseResult.CaseNumber)) {
                                        dataCases.push({
                                            caseId: caseResult.EncryptedCaseId,
                                            caseNumber: caseResult.CaseNumber
                                        });
                                        caseNumberSet.add(caseResult.CaseNumber);
                                    }
                                }
                            }
                        }

                        if (dataCases.length > 0) {
                            console.log(`Data extraction found ${dataCases.length} cases`);
                            return {
                                cases: dataCases,
                                error: undefined
                            };
                        }
                    }
                }

                // Method 2: Try a broader match for grid data
                console.log('Method 2: Using broader grid data match...');
                const altGridMatch = htmlContent.match(/data\s*:\s*(\{.*?\})\s*,/s);
                if (altGridMatch && altGridMatch[1]) {
                    console.log('Alternative match found, attempting to parse...');
                    const altGridJson = JSON.parse(altGridMatch[1]);

                    if (altGridJson && altGridJson.Data && Array.isArray(altGridJson.Data)) {
                        console.log(`Found ${altGridJson.Data.length} data entries using alternative parsing`);

                        // Process the data similar to the main path
                        const altCases = [];
                        for (const party of altGridJson.Data) {
                            if (party.CaseResults && Array.isArray(party.CaseResults)) {
                                for (const caseResult of party.CaseResults) {
                                    if (caseResult.EncryptedCaseId && caseResult.CaseNumber &&
                                        !caseNumberSet.has(caseResult.CaseNumber)) {
                                        altCases.push({
                                            caseId: caseResult.EncryptedCaseId,
                                            caseNumber: caseResult.CaseNumber
                                        });
                                        caseNumberSet.add(caseResult.CaseNumber);
                                    }
                                }
                            }
                        }

                        if (altCases.length > 0) {
                            console.log(`Alternative parsing found ${altCases.length} cases`);
                            return {
                                cases: altCases,
                                error: undefined
                            };
                        }
                    }
                }
            } catch (altError) {
                console.error('Alternative parsing also failed:', altError);
            }

            // Return empty result but with no error - we'll treat this as a search with no results
            return {
                cases: [] as { caseId: string; caseNumber: string }[],
                error: undefined
            };
        }

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
            cases: [],
            error: errorMessage,
        };
    }
}
