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
    const userSession = await PortalAuthenticator.getOrCreateUserSession(req.userId, req.userAgent);

    if (!userSession.success) {
        // Failed to get or create a session - update all cases with failed status
        for (const caseNumber of caseNumbers) {
            results[caseNumber] = {
                zipCase: {
                    caseNumber,
                    fetchStatus: {
                        status: 'failed',
                        message: `Authentication failed: ${userSession.message}`
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
                            const caseId = results[caseNumber].zipCase.caseId;
                            if (caseId) {
                                await QueueClient.queueCaseForDataRetrieval(
                                    caseNumber,
                                    caseId,
                                    req.userId
                                );
                            } else {
                                console.error(
                                    `Case ${caseNumber} has 'found' status but missing caseId`
                                );
                            }
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

    if (casesToQueue.length > 0) {
        console.log(`Queueing ${casesToQueue.length} cases for processing`);
        await QueueClient.queueCasesForSearch(casesToQueue, req.userId, req.userAgent);
    }

    return { results };
}
