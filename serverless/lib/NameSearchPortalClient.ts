import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import AlertService, { Severity, AlertCategory } from './AlertService';
import PortalAuthenticator from './PortalAuthenticator';
import UserAgentClient from './UserAgentClient';

// Interface for the result of a name search
export interface NameSearchResult {
    cases: { caseId: string; caseNumber: string }[];
    error?: string;
}

// Fetch cases by name from the portal
export async function fetchCasesByName(
    name: string,
    cookieJar: CookieJar,
    dateOfBirth?: string,
    soundsLike = false,
    criminalOnly = true
): Promise<NameSearchResult> {
    try {
        // Get the portal URL from environment variable
        const portalUrl = process.env.PORTAL_URL;

        if (!portalUrl) {
            const errorMsg = 'PORTAL_URL environment variable is not set';

            await AlertService.logError(Severity.CRITICAL, AlertCategory.SYSTEM, '', new Error(errorMsg), { resource: 'name-search' });

            return {
                cases: [] as { caseId: string; caseNumber: string }[],
                error: errorMsg,
            };
        }

        const userAgent = await UserAgentClient.getUserAgent('system');

        const client = wrapper(axios).create({
            timeout: 60000,
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

        console.log(
            `Searching for name: ${name}, DOB: ${dateOfBirth || 'not provided'}, sounds-like: ${soundsLike}, criminal-only: ${criminalOnly}`
        );

        // Step 1: Submit the search form with name parameter
        const searchFormData = new URLSearchParams();
        searchFormData.append('caseCriteria.SearchCriteria', name);
        searchFormData.append('caseCriteria.SearchByPartyName', 'true');
        searchFormData.append('caseCriteria.SearchCases', 'true');

        if (criminalOnly) {
            searchFormData.append('caseCriteria.CaseType', 'Criminal and Infraction');
        }

        if (dateOfBirth) {
            searchFormData.append('caseCriteria.DOBFrom', dateOfBirth);
            searchFormData.append('caseCriteria.DOBTo', dateOfBirth);
        }

        if (soundsLike) {
            searchFormData.append('caseCriteria.UseSoundex', 'true');
        }

        const searchResponse = await client.post(`${portalUrl}/Portal/SmartSearch/SmartSearch/SmartSearch`, searchFormData);

        console.log(`Search response status: ${searchResponse.status}`);

        // Step 2: Get the search results page

        // Verify the presence of the essential SmartSearchCriteria cookie
        const cookies = cookieJar.getCookiesSync(`${portalUrl}/Portal`);
        const smartSearchCriteriaCookie = cookies.find(c => c.key === 'SmartSearchCriteria');
        if (!smartSearchCriteriaCookie) {
            console.warn('WARNING: SmartSearchCriteria cookie not found in cookie jar!');

            // If the essential SmartSearchCriteria cookie is missing, we cannot proceed
            const errorMessage = 'Missing SmartSearchCriteria cookie required for search results';
            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                name,
                resource: 'portal-search',
            });

            return {
                cases: [],
                error: errorMessage,
            };
        }

        // Request the search results
        const resultsRequestHeaders: Record<string, string> = {
            Referer: `${portalUrl}/Portal/Home/WorkspaceMode?p=0`,
        };
        const resultsResponse = await client.get(`${portalUrl}/Portal/SmartSearch/SmartSearchResults`, { headers: resultsRequestHeaders });

        console.log(`SmartSearchResults response status: ${resultsResponse.status}`);

        if (resultsResponse.status !== 200) {
            const errorMessage = `Results request failed with status ${resultsResponse.status}`;

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorMessage), {
                name,
                statusCode: resultsResponse.status,
                resource: 'portal-search-results',
            });

            return {
                cases: [],
                error: errorMessage,
            };
        }

        // Check for specific error messages
        const errorString = 'Smart Search is having trouble processing your search';
        if (resultsResponse.data.includes(errorString)) {
            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', new Error(errorString), {
                name,
                resource: 'smart-search',
            });

            return {
                cases: [],
                error: errorString,
            };
        }

        // Step 3: Extract case data from the response

        const htmlContent = resultsResponse.data;
        const cases: { caseId: string; caseNumber: string }[] = [];
        const caseNumberSet = new Set<string>(); // For deduplication

        try {
            // Find the kendoGrid initialization with JSON data
            const kendoGridMatch = htmlContent.match(/jQuery\("#Grid"\)\.kendoGrid\((.*?)\);/s);
            if (kendoGridMatch && kendoGridMatch[1]) {
                // Extract the raw JSON text for debugging
                const gridDataText = kendoGridMatch[1].trim();
                let gridJson;

                try {
                    const dataMatch = gridDataText.match(/"data":\{"Data":.*?"Total":\d+\}\}/s);

                    if (!dataMatch) {
                        throw new Error('Could not find data section in grid JSON');
                    }

                    try {
                        // Add leading open curly brace to make a valid JSON string
                        gridJson = JSON.parse(`{${dataMatch[0]}`);
                    } catch (parseError) {
                        console.error('Failed to parse data section:', parseError);
                        throw new Error('Failed to parse JSON data section');
                    }

                    if (!gridJson?.data?.Data) {
                        throw new Error('Parsed JSON does not contain expected data structure');
                    }

                    console.log(`Found ${gridJson.data.Data.length} data entries in grid`);
                } catch (error) {
                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.PORTAL,
                        '',
                        error instanceof Error
                            ? error
                            : new Error(`Error parsing search results: ${String(error)}`),
                        {
                            name,
                            resource: 'portal-search-results-json',
                        }
                    );

                    return {
                        cases: [],
                        error: `Error parsing search results: ${error instanceof Error ? error.message : String(error)}`,
                    };
                }

                // If we have valid grid data, process it
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
                                        caseNumber: caseResult.CaseNumber,
                                    });
                                    caseNumberSet.add(caseResult.CaseNumber);
                                    console.log(`Found case: ${caseResult.CaseNumber}, ID: ${caseResult.EncryptedCaseId}`);
                                }
                            }
                        }
                    }
                }
            }

            console.log(`Found ${cases.length} unique case entries`);

            return {
                cases,
                error: undefined,
            };
        } catch (jsonError) {
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
                'unauthorized',
            ];

            for (const errorText of errorMessages) {
                if (htmlContent.toLowerCase().includes(errorText.toLowerCase())) {
                    console.log(`Found error text in response: "${errorText}"`);
                }
            }

            // If JSON parsing has failed, we cannot proceed
            const errorMessage = 'Failed to parse search results data';
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                '',
                jsonError instanceof Error ? jsonError : new Error(errorMessage),
                {
                    name,
                    resource: 'portal-search-results',
                }
            );

            return {
                cases: [],
                error: errorMessage,
            };
        }
    } catch (error) {
        const err = error as Error;

        await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, '', err, {
            name,
            resource: 'name-search',
        });

        return {
            cases: [],
            error: `Error searching by name: ${err.message}`,
        };
    }
}
