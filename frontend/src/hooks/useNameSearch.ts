import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ZipCaseClient } from '../services';
import { SearchResult } from '../../../shared/types/Search';

const client = new ZipCaseClient();

interface NameSearchParams {
    name: string;
    dateOfBirth?: string;
    soundsLike: boolean;
}

/**
 * Custom hook for name search operations.
 * This hook provides mutation functionality and handles polling for search results.
 */
export function useNameSearch() {
    const queryClient = useQueryClient();

    /**
     * Start polling for name search results.
     * This function is defined inside the hook to properly use React hooks.
     */
    const startPolling = (searchId: string) => {
        const pollNameSearch = async () => {
            try {
                console.log(`Polling name search with ID: ${searchId}`);
                const response = await client.cases.nameSearchStatus(searchId);

                if (!response.success) {
                    console.error(`Failed to poll name search ${searchId}:`, response.error);
                    return;
                }

                const results = response.data?.results || {};

                // If we have results, update the state
                if (Object.keys(results).length > 0) {
                    // Get existing state
                    const existingState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                        results: {},
                        searchBatches: [],
                        nameSearches: {},
                    };

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
                    // and if there are actually results
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
                        }
                    };

                    // Update the query cache
                    queryClient.setQueryData(['searchResults'], {
                        results: mergedResults,
                        searchBatches: updatedBatches,
                        nameSearches: updatedNameSearches,
                    });
                }

                // Schedule the next poll
                setTimeout(pollNameSearch, 3000);
            } catch (error) {
                console.error(`Error polling name search ${searchId}:`, error);
                // Schedule the next poll even if this one failed
                setTimeout(pollNameSearch, 3000);
            }
        };

        // Start polling
        setTimeout(pollNameSearch, 3000);
    };

    return useMutation({
        mutationFn: async (searchParams: NameSearchParams) => {
            const response = await client.cases.nameSearch(
                searchParams.name,
                searchParams.dateOfBirth,
                searchParams.soundsLike
            );
            console.log('Raw name search response in mutationFn:', response);

            if (!response.success) {
                throw new Error(response.error || 'Failed to search for names');
            }

            console.log('Returning data from nameSearch mutationFn:', response.data);
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
                console.warn('No searchId in name search response');
                return;
            }

            if (Object.keys(results).length === 0) {
                console.log('No initial results in name search response, will poll for updates');
            }

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
                }
            };

            // Merge results
            const mergedResults = { ...existingState.results, ...processedResults };

            console.log('Merged name search results:', mergedResults);
            console.log('Updated name searches:', updatedNameSearches);

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
    // Function to start polling for name search results
    function startNameSearchPolling(searchId: string) {
        const queryClient = useQueryClient();

        const pollNameSearch = async () => {
            try {
                const response = await client.cases.nameSearchStatus(searchId);

                if (!response.success) {
                    console.error(`Failed to poll name search ${searchId}:`, response.error);
                    return;
                }

                const results = response.data?.results || {};

                // If we have results, update the state
                if (Object.keys(results).length > 0) {
                    // Get existing state
                    const existingState = queryClient.getQueryData<ResultsState>([
                        'searchResults',
                    ]) || {
                        results: {},
                        searchBatches: [],
                        nameSearches: {},
                    };

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
                    // and if there are actually results
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
                        },
                    };

                    // Update the query cache
                    queryClient.setQueryData(['searchResults'], {
                        results: mergedResults,
                        searchBatches: updatedBatches,
                        nameSearches: updatedNameSearches,
                    });
                }

                // Schedule the next poll
                setTimeout(pollNameSearch, 3000);
            } catch (error) {
                console.error(`Error polling name search ${searchId}:`, error);
                // Schedule the next poll even if this one failed
                setTimeout(pollNameSearch, 3000);
            }
        };

        // Start polling
        setTimeout(pollNameSearch, 3000);
    }
}

// Extended ResultsState interface to include name searches
interface NameSearchMetadata {
    searchId: string;
    lastPolled: string;
}

interface ResultsState {
    results: Record<string, SearchResult>;
    searchBatches: string[][]; // Array of case number batches, newest first
    nameSearches: Record<string, NameSearchMetadata>;
}

