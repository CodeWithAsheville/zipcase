import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ZipCaseClient } from '../services';
import { SearchResult } from '../../../shared/types/Search';

interface NameSearchParams {
    name: string;
    dateOfBirth?: string;
    soundsLike: boolean;
    criminalOnly?: boolean;
}

/**
 * Custom hook for name search operations.
 * This hook provides mutation functionality and handles polling for search results.
 */
export function useNameSearch() {
    const queryClient = useQueryClient();

    // Instantiate client inside the hook so test mocks are picked up
    const client = new ZipCaseClient();

    /**
     * Start polling for name search results.
     * This function is defined inside the hook to properly use React hooks.
     */
    const startPolling = (searchId: string) => {
        // Create a ref-like object for tracking polling state
        const pollingState = {
            active: true,
            lastChangeTime: Date.now(),
            timeoutId: null as NodeJS.Timeout | null,
        };

        const pollNameSearch = async () => {
            try {
                console.log(`Polling name search with ID: ${searchId}`);
                const response = await client.cases.nameSearchStatus(searchId);

                if (!response.success) {
                    console.error(`Failed to poll name search ${searchId}:`, response.error);
                    scheduleNextPoll();
                    return;
                }

                const results = response.data?.results || {};
                const hasNewResults = Object.keys(results).length > 0;

                // Get existing state
                const existingState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                    results: {},
                    searchBatches: [],
                    nameSearches: {},
                };

                // If we have new results, update the state
                if (hasNewResults) {
                    // New results found, update the last change time
                    pollingState.lastChangeTime = Date.now();

                    // Merge new results with existing ones
                    const mergedResults = { ...existingState.results, ...results };

                    // Get case numbers from this batch of results
                    const newCaseNumbers = Object.keys(results);

                    // Check if we already have a batch containing these case numbers
                    const existingBatchIndex = existingState.searchBatches.findIndex(
                        batch =>
                            newCaseNumbers.length > 0 &&
                            newCaseNumbers.every(caseNumber => batch.includes(caseNumber))
                    );

                    // Only add a new batch if we don't already have one with these case numbers
                    let updatedBatches = [...existingState.searchBatches];
                    if (existingBatchIndex === -1 && newCaseNumbers.length > 0) {
                        updatedBatches = [newCaseNumbers, ...updatedBatches];
                    }

                    // Update the last polled time
                    const now = new Date().toISOString();
                    const updatedNameSearches = {
                        ...existingState.nameSearches,
                        [searchId]: {
                            ...existingState.nameSearches[searchId],
                            lastPolled: now,
                            lastNewResult: now,
                        },
                    };

                    // Update the query cache
                    queryClient.setQueryData(['searchResults'], {
                        results: mergedResults,
                        searchBatches: updatedBatches,
                        nameSearches: updatedNameSearches,
                    });
                } else {
                    // No new results, just update the lastPolled time
                    const now = new Date().toISOString();
                    queryClient.setQueryData(['searchResults'], {
                        ...existingState,
                        nameSearches: {
                            ...existingState.nameSearches,
                            [searchId]: {
                                ...existingState.nameSearches[searchId],
                                lastPolled: now,
                            },
                        },
                    });
                }

                // Schedule the next poll
                scheduleNextPoll();
            } catch (error) {
                console.error(`Error polling name search ${searchId}:`, error);
                // Schedule the next poll even if this one failed
                scheduleNextPoll();
            }
        };

        // Function to schedule the next poll or stop polling
        const scheduleNextPoll = () => {
            // Calculate how long we've been polling without any state changes
            const elapsedSinceChange = (Date.now() - pollingState.lastChangeTime) / 1000;

            // If we've been polling for more than 30 seconds without changes, stop
            if (elapsedSinceChange > 30) {
                console.log(`Stopping polling for search ${searchId} after 30 seconds with no new results`);
                // Update state to mark polling as complete
                const existingState = queryClient.getQueryData<ResultsState>(['searchResults']);
                if (existingState?.nameSearches) {
                    queryClient.setQueryData(['searchResults'], {
                        ...existingState,
                        nameSearches: {
                            ...existingState.nameSearches,
                            [searchId]: {
                                ...existingState.nameSearches[searchId],
                                pollingComplete: true,
                            },
                        },
                    });
                }
                pollingState.active = false;
                return;
            }

            // Schedule next poll in 3 seconds
            pollingState.timeoutId = setTimeout(() => {
                if (pollingState.active) {
                    pollNameSearch();
                }
            }, 3000);
        };

        // Start polling after 3 seconds
        pollingState.timeoutId = setTimeout(pollNameSearch, 3000);
    };

    return useMutation({
        mutationFn: async (searchParams: NameSearchParams) => {
            const response = await client.cases.nameSearch(
                searchParams.name,
                searchParams.dateOfBirth,
                searchParams.soundsLike,
                searchParams.criminalOnly
            );

            if (!response.success) {
                throw new Error(response.error || 'Failed to search for names');
            }

            return response.data;
        },
        onSuccess: data => {
            const results = data?.results || {};
            const searchId = data?.searchId;

            if (data?.success === false && data?.error) {
                console.error(`Name search error: ${data.error}`);
                return;
            }

            if (!searchId) {
                return;
            }

            // Nothing special to do if there are no results
            // if (Object.keys(results).length === 0) { ... }

            // Get existing state from query client
            const existingState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
                nameSearches: {},
            };

            // Process new results to ensure they have current lastUpdated time if not present
            const now = new Date().toISOString();
            const processedResults: Record<string, SearchResult> = {};

            Object.entries(results).forEach(([caseNumber, result]) => {
                // If the result doesn't have a lastUpdated time or is new/queued, add current time
                if (!result.zipCase.lastUpdated || result.zipCase.fetchStatus.status === 'queued') {
                    processedResults[caseNumber] = {
                        ...result,
                        zipCase: {
                            ...result.zipCase,
                            lastUpdated: now,
                        },
                    };
                } else {
                    processedResults[caseNumber] = result;
                }
            });

            // Create a new batch with the case numbers from this search
            const newBatch = Object.keys(processedResults);

            // Only create a batch if there are any results
            const updatedBatches = newBatch.length > 0
                ? [newBatch, ...existingState.searchBatches]
                : existingState.searchBatches;

            // Store the search ID in our nameSearches map
            const updatedNameSearches = {
                ...existingState.nameSearches,
                [searchId]: {
                    searchId,
                    lastPolled: now,
                },
            };

            // Merge results
            const mergedResults = { ...existingState.results, ...processedResults };

            // Store the updated state in the query cache
            queryClient.setQueryData(['searchResults'], {
                results: mergedResults,
                searchBatches: updatedBatches,
                nameSearches: updatedNameSearches,
            });

            // Start polling for name search results if we have a searchId
            if (searchId) {
                startPolling(searchId);
            }
        },
    });
}

// Extended ResultsState interface to include name searches
interface NameSearchMetadata {
    searchId: string;
    lastPolled: string;
    lastNewResult?: string;
    pollingComplete?: boolean;
}

interface ResultsState {
    results: Record<string, SearchResult>;
    searchBatches: string[][]; // Array of case number batches, newest first
    nameSearches: Record<string, NameSearchMetadata>;
}
