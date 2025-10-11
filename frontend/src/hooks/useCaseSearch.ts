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

            if (!response.success) {
                throw new Error(response.error || 'Failed to search for cases');
            }

            return response.data;
        },
        onSuccess: data => {
            // Extract results from the response
            const results = data?.results || {};

            if (Object.keys(results).length === 0) {
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

            Object.entries(results).forEach(([caseNumber, result]: [string, SearchResult]) => {
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

export function useRemoveCase() {
    const queryClient = useQueryClient();

    return (caseNumber: string) => {
        const currentState = queryClient.getQueryData<ResultsState>(['searchResults']);

        if (!currentState) {
            return;
        }

        // Remove the case from results
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [caseNumber]: _removed, ...remainingResults } = currentState.results;

        // Remove the case from all batches
        const updatedBatches = currentState.searchBatches
            .map(batch => batch.filter(cn => cn !== caseNumber))
            .filter(batch => batch.length > 0); // Remove empty batches

        // Update the query cache
        queryClient.setQueryData(['searchResults'], {
            results: remainingResults,
            searchBatches: updatedBatches,
        });
    };
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

    // Extract non-terminal case numbers that need polling
    const getNonTerminalCaseNumbers = (): string[] => {
        // Get state directly from the queryClient instead of through hook for freshest data
        const state = queryClient.getQueryData<ResultsState>(['searchResults']);
        if (!state || !state.results) {
            return [];
        }

        const terminalStates = ['complete', 'failed'];

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
            pollingRef.current.active = false;
            return;
        }

        // Increment poll count
        pollingRef.current.pollCount++;

        try {
            // Use the dedicated status endpoint to poll multiple cases at once
            const response = await client.cases.status(caseNumbers);

            if (!response.success) {
                scheduleNextPoll();
                return;
            }

            const results = response.data?.results || {};

            // Check if we have any state changes
            let hasStateChanges = false;
            const currentState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
            };

            Object.entries(results).forEach(([caseNumber, result]: [string, SearchResult]) => {
                const existingResult = currentState.results[caseNumber];
                if (!existingResult || existingResult.zipCase.fetchStatus.status !== result.zipCase.fetchStatus.status) {
                    hasStateChanges = true;
                }
            });

            // If we have changes, reset the polling timer
            if (hasStateChanges) {
                pollingRef.current.lastChangeTime = Date.now();
                pollingRef.current.pollCount = 0;
            }

            // Create the new merged state
            const newState = {
                results: { ...currentState.results, ...results },
                searchBatches: currentState.searchBatches,
            };

            // Update the query data without invalidation
            queryClient.setQueryData(['searchResults'], newState);

            // Schedule the next poll
            scheduleNextPoll();
        } catch {
            scheduleNextPoll();
        }
    };

    // Function to schedule the next poll or stop polling
    const scheduleNextPoll = () => {
        // Calculate how long we've been polling without any state changes
        const elapsedSinceChange = (Date.now() - pollingRef.current.lastChangeTime) / 1000;

        // If we've been polling for more than 30 seconds without changes, stop
        if (elapsedSinceChange > 30) {
            pollingRef.current.active = false;
            return;
        }

        // Check if there are any non-terminal cases left
        const nonTerminalCases = getNonTerminalCaseNumbers();
        if (nonTerminalCases.length === 0) {
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
        // Store a reference to the current polling ref
        const currentPollingRef = pollingRef.current;

        return () => {
            if (currentPollingRef.timeoutId) {
                clearTimeout(currentPollingRef.timeoutId);
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
