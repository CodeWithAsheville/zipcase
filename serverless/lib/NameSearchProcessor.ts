import { v4 as uuidv4 } from 'uuid';
import { NameSearchRequest, NameSearchResponse, NameSearchData } from '../../shared/types/Search';
import StorageClient from './StorageClient';
import NameParser from './NameParser';
import QueueClient from './QueueClient';
import PortalAuthenticator from './PortalAuthenticator';
import AlertService, { Severity, AlertCategory } from './AlertService';

export async function processNameSearchRequest(req: NameSearchRequest, userId: string): Promise<NameSearchResponse> {
    // Check user auth/session
    const userSession = await StorageClient.getUserSession(userId);
    let searchId = '';

    try {
        // Normalize the name input
        const normalizedName = NameParser.parseAndStandardizeName(req.name);

        if (!normalizedName) {
            return {
                searchId: '',
                results: {}
            };
        }

        // Generate a unique ID for this search
        searchId = uuidv4();

        // Store the search data in DynamoDB with TTL of 24 hours
        const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now

        const nameSearchData: NameSearchData = {
            originalName: req.name,
            normalizedName,
            dateOfBirth: req.dateOfBirth,
            soundsLike: req.soundsLike,
            cases: [],
        };

        await StorageClient.saveNameSearch(searchId, nameSearchData, expiresAt);

        // Queue the name search for processing
        if (userSession) {
            console.log(`Queueing name search ${searchId} for processing with existing session`);
            await QueueClient.queueNameSearchForProcessing(
                searchId,
                userId,
                req.name,
                req.dateOfBirth,
                req.soundsLike,
                req.userAgent
            );
        } else {
            // No user session - need to check for portal credentials
            const portalCredentials = await StorageClient.sensitiveGetPortalCredentials(userId);

            if (portalCredentials) {
                try {
                    // Authenticate with portal using user agent if provided
                    const authResult = await PortalAuthenticator.authenticateWithPortal(
                        portalCredentials.username,
                        portalCredentials.password,
                        { userAgent: req.userAgent }
                    );

                    if (!authResult.success || !authResult.cookieJar) {
                        const errorMsg = `Failed to authenticate with portal for user ${userId}: ${authResult.message}`;
                        console.error(errorMsg);

                        await AlertService.logError(
                            Severity.ERROR,
                            AlertCategory.AUTHENTICATION,
                            errorMsg,
                            undefined,
                            { userId, searchId }
                        );

                        // Get the existing search data
                        const existingSearch = await StorageClient.getNameSearch(searchId);
                        if (existingSearch) {
                            await StorageClient.saveNameSearch(searchId, {
                                ...existingSearch,
                                status: 'failed',
                                message: `Authentication failed: ${authResult.message}`,
                            });
                        }
                    } else {
                        // Store the session token (cookie jar)
                        const sessionToken = JSON.stringify(authResult.cookieJar.toJSON());

                        // Calculate expiration time (24 hours from now)
                        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

                        await StorageClient.saveUserSession(userId, sessionToken, expiresAt);
                        console.log(
                            `Successfully authenticated and stored session for user ${userId}`
                        );

                        // Now queue the name search for processing
                        await QueueClient.queueNameSearchForProcessing(
                            searchId,
                            userId,
                            req.name,
                            req.dateOfBirth,
                            req.soundsLike,
                            req.userAgent
                        );
                    }
                } catch (error) {
                    const errorMsg = `Failed to authenticate with portal for user ${userId} due to exception`;
                    console.error(errorMsg, error);

                    await AlertService.logError(
                        Severity.ERROR,
                        AlertCategory.AUTHENTICATION,
                        errorMsg,
                        error instanceof Error ? error : new Error(String(error)),
                        { userId, searchId }
                    );

                    // Get the existing search data
                    const existingSearch = await StorageClient.getNameSearch(searchId);
                    if (existingSearch) {
                        await StorageClient.saveNameSearch(searchId, {
                            ...existingSearch,
                            status: 'failed',
                            message: `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                }
            } else {
                const errorMsg = `No portal credentials found for user ${userId}`;
                console.log(errorMsg);

                await AlertService.logError(
                    Severity.WARNING,
                    AlertCategory.AUTHENTICATION,
                    errorMsg,
                    undefined,
                    { userId, searchId }
                );

                // Get the existing search data
                const existingSearch = await StorageClient.getNameSearch(searchId);
                if (existingSearch) {
                    await StorageClient.saveNameSearch(searchId, {
                        ...existingSearch,
                        status: 'failed',
                        message: 'No portal credentials found',
                    });
                }
            }
        }

        const nameSearchStatus = await StorageClient.getNameSearch(searchId);

        if (nameSearchStatus && nameSearchStatus.status === 'failed') {
            return {
                searchId,
                results: {},
                success: false,
                error: nameSearchStatus.message || 'Authentication failed'
            };
        }

        return {
            searchId,
            results: {},
            success: true
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

        if (searchId) {
            // Get the existing search data
            const existingSearch = await StorageClient.getNameSearch(searchId);
            if (existingSearch) {
                await StorageClient.saveNameSearch(searchId, {
                    ...existingSearch,
                    status: 'failed',
                    message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }

        return {
            searchId: searchId || '',
            results: {},
            success: false,
            error: 'Internal error processing name search'
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
        };
    } catch (error) {
        console.error('Error getting name search results:', error);
        return {
            searchId,
            results: {},
        };
    }
}