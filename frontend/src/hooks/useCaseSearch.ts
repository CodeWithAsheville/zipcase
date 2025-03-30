import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { ZipCaseClient } from '../services';
import { SearchResult } from '../../../shared/types';

const client = new ZipCaseClient();

export function useCaseSearch() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (searchInput: string) => {
            const response = await client.cases.search(searchInput);
            console.log('Raw search response in mutationFn:', response);

            if (!response.success) {
                throw new Error(response.error || 'Failed to search for cases');
            }

            console.log('Returning data from mutationFn:', response.data);
            return response.data;
        },
        onSuccess: data => {
            console.log('Search mutation success with data:', data);

            // Extract results from the response
            const results = data?.results || {};

            if (Object.keys(results).length === 0) {
                console.warn('No results in search response');
                return;
            }

            // Get existing state from query client
            const existingState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
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

            // Add new batch to the beginning of searchBatches array
            const updatedBatches = [newBatch, ...existingState.searchBatches];

            // Merge results
            const mergedResults = { ...existingState.results, ...processedResults };

            console.log('Merged search results:', mergedResults);
            console.log('Updated search batches:', updatedBatches);

            // Store the updated state in the query cache
            queryClient.setQueryData(['searchResults'], {
                results: mergedResults,
                searchBatches: updatedBatches,
            });
        },
    });
}

interface ResultsState {
    results: Record<string, SearchResult>;
    searchBatches: string[][]; // Array of case number batches, newest first
}

export function useSearchResults() {
    const queryClient = useQueryClient();

    return useQuery<ResultsState, Error>({
        queryKey: ['searchResults'],
        // Get the current state from cache
        queryFn: () => {
            const state = queryClient.getQueryData<ResultsState>(['searchResults']);
            return state || { results: {}, searchBatches: [] };
        },
        initialData: { results: {}, searchBatches: [] },
        staleTime: Infinity, // Don't refetch automatically
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}

export function useConsolidatedPolling() {
    const queryClient = useQueryClient();

    // Reference to track polling state across renders
    const pollingRef = useRef({
        active: false, // Whether polling is currently active
        lastChangeTime: Date.now(), // Last time a status changed
        timeoutId: null as NodeJS.Timeout | null, // For manual timeout handling
        pollCount: 0, // Count of polls since last change
    });

    // Get all current search results
    const allResults = useSearchResults();

    // Extract non-terminal case numbers that need polling
    const getNonTerminalCaseNumbers = (): string[] => {
        // Get state directly from the queryClient instead of through hook for freshest data
        const state = queryClient.getQueryData<ResultsState>(['searchResults']);
        if (!state || !state.results) {
            return [];
        }

        // Define terminal states
        const terminalStates = ['complete', 'notFound', 'failed'];

        return Object.values(state.results)
            .filter(result => {
                const status = result.zipCase.fetchStatus.status;
                return !terminalStates.includes(status);
            })
            .map(result => result.zipCase.caseNumber);
    };

    // Function to poll all non-terminal cases
    const pollNonTerminalCases = async () => {
        const caseNumbers = getNonTerminalCaseNumbers();

        // Clear any existing timeout
        if (pollingRef.current.timeoutId) {
            clearTimeout(pollingRef.current.timeoutId);
            pollingRef.current.timeoutId = null;
        }

        // Stop if there are no non-terminal cases
        if (caseNumbers.length === 0) {
            console.log('No cases to poll, stopping');
            pollingRef.current.active = false;
            return;
        }

        // Increment poll count
        pollingRef.current.pollCount++;

        console.log(
            `Polling ${caseNumbers.length} non-terminal cases (poll #${pollingRef.current.pollCount})`,
            caseNumbers
        );

        try {
            // Use the dedicated status endpoint to poll multiple cases at once
            const response = await client.cases.status(caseNumbers);

            if (!response.success) {
                console.error('Failed to poll cases:', response.error);
                scheduleNextPoll();
                return;
            }

            const results = response.data?.results || {};

            // Log raw response data from status endpoint
            console.log('Status endpoint response results:', results);

            // Check if we have any state changes
            let hasStateChanges = false;
            const currentState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
            };

            Object.entries(results).forEach(([caseNumber, result]) => {
                const existingResult = currentState.results[caseNumber];
                if (
                    !existingResult ||
                    existingResult.zipCase.fetchStatus.status !== result.zipCase.fetchStatus.status
                ) {
                    hasStateChanges = true;
                }
            });

            // If we have changes, reset the polling timer
            if (hasStateChanges) {
                console.log('State changes detected, resetting polling timer');
                pollingRef.current.lastChangeTime = Date.now();
                pollingRef.current.pollCount = 0;
            }

            // Get the state again to ensure we have the latest data

            // Log the change in status for each case
            Object.entries(results).forEach(([caseNumber, result]) => {
                const existingResult = currentState.results[caseNumber];
                const oldStatus = existingResult?.zipCase.fetchStatus.status;
                const newStatus = result.zipCase.fetchStatus.status;

                if (oldStatus !== newStatus) {
                    console.log(
                        `Status change detected for case ${caseNumber}: ${oldStatus} -> ${newStatus}`
                    );
                }
            });

            // Create the new merged state
            const newState = {
                results: { ...currentState.results, ...results },
                searchBatches: currentState.searchBatches,
            };

            // Update the query data without invalidation
            queryClient.setQueryData(['searchResults'], newState);

            // Schedule the next poll
            scheduleNextPoll();
        } catch (error) {
            console.error('Error during consolidated polling:', error);
            scheduleNextPoll();
        }
    };

    // Function to schedule the next poll or stop polling
    const scheduleNextPoll = () => {
        // Calculate how long we've been polling without any state changes
        const elapsedSinceChange = (Date.now() - pollingRef.current.lastChangeTime) / 1000;

        // If we've been polling for more than 30 seconds without changes, stop
        if (elapsedSinceChange > 30) {
            console.log(
                `Polling timeout reached after ${elapsedSinceChange.toFixed(1)} seconds without state changes`
            );
            pollingRef.current.active = false;
            return;
        }

        // Check if there are any non-terminal cases left
        const nonTerminalCases = getNonTerminalCaseNumbers();

        // Log each case with its status for debugging - use direct query client access
        const state = queryClient.getQueryData<ResultsState>(['searchResults']);
        if (state && state.results) {
            const terminalStates = ['complete', 'notFound', 'failed'];
            const statuses = Object.entries(state.results).map(([caseNumber, result]) => ({
                caseNumber,
                status: result.zipCase.fetchStatus.status,
                isTerminal: terminalStates.includes(result.zipCase.fetchStatus.status),
            }));
            console.log('Current case statuses (from queryClient):', statuses);
        }

        if (nonTerminalCases.length === 0) {
            console.log('No more non-terminal cases, stopping polling');
            pollingRef.current.active = false;
            return;
        }

        // Schedule next poll in 3 seconds
        pollingRef.current.timeoutId = setTimeout(() => {
            pollNonTerminalCases();
        }, 3000);
    };

    // Start polling if it's not already active
    const startPolling = () => {
        if (!pollingRef.current.active) {
            console.log('Starting polling (first poll in 3 seconds)');
            pollingRef.current.active = true;
            pollingRef.current.lastChangeTime = Date.now();
            pollingRef.current.pollCount = 0;

            // Wait 3 seconds before the first poll
            pollingRef.current.timeoutId = setTimeout(() => {
                pollNonTerminalCases();
            }, 3000);

            return true;
        }
        return false;
    };

    // Stop polling if it's active
    const stopPolling = () => {
        if (pollingRef.current.active) {
            console.log('Stopping polling');
            if (pollingRef.current.timeoutId) {
                clearTimeout(pollingRef.current.timeoutId);
                pollingRef.current.timeoutId = null;
            }
            pollingRef.current.active = false;
            return true;
        }
        return false;
    };

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current.timeoutId) {
                clearTimeout(pollingRef.current.timeoutId);
            }
        };
    }, []);

    // Placeholder query to make this hook compatible with the existing API
    const query = useQuery({
        queryKey: ['consolidatedPolling'],
        queryFn: async () => ({ timestamp: Date.now(), active: pollingRef.current.active }),
        // Don't actually do refetching through React Query's mechanism
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
    });

    return {
        ...query,
        isPolling: pollingRef.current.active,
        pollNow: pollNonTerminalCases,
        startPolling,
        stopPolling,
    };
}

// For backward compatibility - individual case polling will now just check the cache
export function useCaseStatusPolling(caseNumber: string) {
    const queryClient = useQueryClient();
    const consolidatedPolling = useConsolidatedPolling();

    // This will set up a minimal query that just returns the data from the cache
    const query = useQuery<SearchResult | null, Error>({
        queryKey: ['searchResult', caseNumber],
        queryFn: () => {
            const state = queryClient.getQueryData<ResultsState>(['searchResults']);
            if (!state || !state.results) {
                return null;
            }
            return state.results[caseNumber] || null;
        },
        // Don't actually fetch anything on our own - let the consolidated polling handle it
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
    });

    return query;
}
