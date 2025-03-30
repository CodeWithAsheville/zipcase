import QueueClient from './QueueClient';
import SearchParser from './SearchParser';
import StorageClient from './StorageClient';
import PortalAuthenticator from './PortalAuthenticator';
import { SearchRequest, SearchResponse, SearchResult } from '../../shared/types';

export async function processSearchRequest(req: SearchRequest): Promise<SearchResponse> {
    let caseNumbers = SearchParser.parseSearchInput(req.input);
    caseNumbers = Array.from(new Set(caseNumbers));

    if (caseNumbers.length === 0) {
        return { results: {} };
    }

    // Get existing results from storage
    const results: Record<string, SearchResult> = await StorageClient.getSearchResults(caseNumbers);

    // Get or create a user session first - this is critical for portal authentication
    const userSession = await StorageClient.getUserSession(req.userId);

    // Cases that need to be queued (not found or in terminal states)
    const casesToQueue: string[] = [];

    for (const caseNumber of caseNumbers) {
        try {
            // Check if the case exists and if its status should be preserved
            if (caseNumber in results) {
                const status = results[caseNumber].zipCase.fetchStatus.status;

                // Keep the existing status for all these states
                if (['complete', 'processing', 'found', 'notFound'].includes(status)) {
                    console.log(`Case ${caseNumber} already has status ${status}, preserving`);

                    // Handle 'found' cases specially - queue directly for data retrieval
                    if (status === 'found' && results[caseNumber].zipCase.caseId) {
                        // Skip adding to search queue since it's already found
                        // Instead, queue directly for data retrieval if not already complete
                        console.log(
                            `Case ${caseNumber} has 'found' status with caseId, queueing for data retrieval`
                        );
                        try {
                            await QueueClient.queueCaseForDataRetrieval(
                                caseNumber,
                                results[caseNumber].zipCase.caseId,
                                req.userId
                            );
                        } catch (error) {
                            console.error(
                                `Error queueing case ${caseNumber} for data retrieval:`,
                                error
                            );
                        }
                        continue;
                    }

                    // For other non-terminal states, queue for normal search processing
                    if (!['complete', 'notFound', 'failed'].includes(status)) {
                        casesToQueue.push(caseNumber);
                    }
                    continue;
                }

                // For other statuses (failed, queued), we'll re-queue
                casesToQueue.push(caseNumber);
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

    // If we have cases to queue and a user session exists, queue them
    if (casesToQueue.length > 0) {
        if (userSession) {
            console.log(
                `Queueing ${casesToQueue.length} cases for processing with existing session`
            );
            await QueueClient.queueCasesForSearch(casesToQueue, req.userId);
        } else {
            // No user session - need to check for portal credentials
            const portalCredentials = await StorageClient.sensitiveGetPortalCredentials(req.userId);

            if (portalCredentials) {
                try {
                    // Authenticate with portal
                    const authResult = await PortalAuthenticator.authenticateWithPortal(
                        portalCredentials.username,
                        portalCredentials.password
                    );

                    if (!authResult.success || !authResult.cookieJar) {
                        console.error(
                            `Failed to authenticate with portal for user ${req.userId}`,
                            authResult.message
                        );

                        // Update failed cases status
                        for (const caseNumber of casesToQueue) {
                            results[caseNumber] = {
                                zipCase: {
                                    caseNumber,
                                    fetchStatus: {
                                        status: 'failed',
                                        message:
                                            'Authentication failed: ' +
                                            (authResult.message || 'Unknown error'),
                                    },
                                },
                            };
                        }
                    } else {
                        // Store the session token (cookie jar)
                        const sessionToken = JSON.stringify(authResult.cookieJar.toJSON());

                        // Calculate expiration time (24 hours from now)
                        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

                        await StorageClient.saveUserSession(req.userId, sessionToken, expiresAt);
                        console.log(
                            `Successfully authenticated and stored session for user ${req.userId}`
                        );

                        // Now queue the cases for processing
                        await QueueClient.queueCasesForSearch(casesToQueue, req.userId);
                    }
                } catch (error) {
                    console.error(
                        `Failed to authenticate with portal for user ${req.userId}:`,
                        error
                    );

                    // Update failed cases status
                    for (const caseNumber of casesToQueue) {
                        results[caseNumber] = {
                            zipCase: {
                                caseNumber,
                                fetchStatus: {
                                    status: 'failed',
                                    message: 'Authentication failed: ' + (error as Error).message,
                                },
                            },
                        };
                    }
                }
            } else {
                console.log(`No portal credentials found for user ${req.userId}`);

                // Update failed cases status
                for (const caseNumber of casesToQueue) {
                    results[caseNumber] = {
                        zipCase: {
                            caseNumber,
                            fetchStatus: {
                                status: 'failed',
                                message: 'Portal credentials required',
                            },
                        },
                    };
                }
            }
        }
    }

    return { results };
}
