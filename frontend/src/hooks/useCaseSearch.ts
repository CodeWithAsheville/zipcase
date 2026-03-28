import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useCallback } from 'react';
import { ZipCaseClient, zipCaseSocketClient } from '../services';
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

// Hook for file-based search
export function useFileSearch() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (file: File) => {
            // 1. Get upload URL
            const extension = file.name.split('.').pop() || 'pdf';
            const uploadUrlRes = await client.cases.getUploadUrl(extension, file.type);

            if (!uploadUrlRes.success || !uploadUrlRes.data) {
                throw new Error(uploadUrlRes.error || 'Failed to get upload URL');
            }

            const { uploadUrl, key } = uploadUrlRes.data;

            // 2. Upload file to S3
            const uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type,
                },
            });

            if (!uploadRes.ok) {
                throw new Error('Failed to upload file');
            }

            // 3. Process file search
            const searchRes = await client.cases.searchFile(key);

            if (!searchRes.success) {
                throw new Error(searchRes.error || 'Failed to process file');
            }

            return searchRes.data;
        },
        onSuccess: data => {
            // Reuse the same success logic as text search
            const results = data?.results || {};

            if (Object.keys(results).length === 0) {
                return;
            }

            const existingState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
            };

            const now = new Date().toISOString();
            const processedResults: Record<string, SearchResult> = {};

            Object.entries(results).forEach(([caseNumber, result]: [string, SearchResult]) => {
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

            const newBatch = Object.keys(processedResults);
            const updatedBatches = [newBatch, ...existingState.searchBatches];
            const mergedResults = { ...existingState.results, ...processedResults };

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
    nameSearches?: Record<string, unknown>;
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

    const pollingRef = useRef({
        active: false,
        subscribedCases: new Set<string>(),
        unsubscribeHandler: null as (() => void) | null,
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

    const upsertSocketResult = useCallback(
        (result: SearchResult) => {
            const caseNumber = result.zipCase.caseNumber;
            const currentState = queryClient.getQueryData<ResultsState>(['searchResults']) || {
                results: {},
                searchBatches: [],
            };

            queryClient.setQueryData(['searchResults'], {
                ...currentState,
                results: {
                    ...currentState.results,
                    [caseNumber]: result,
                },
            });
        },
        [queryClient]
    );

    const pollNonTerminalCases = useCallback(async () => {
        const caseNumbers = getNonTerminalCaseNumbers();

        if (caseNumbers.length === 0) {
            return;
        }

        if (!pollingRef.current.unsubscribeHandler) {
            pollingRef.current.unsubscribeHandler = zipCaseSocketClient.onMessage(event => {
                if (event.type !== 'case.status.updated' || event.subjectType !== 'case') {
                    return;
                }

                const payload = event.payload as SearchResult;
                if (!payload?.zipCase?.caseNumber) {
                    return;
                }

                upsertSocketResult(payload);
            });
        }

        try {
            await zipCaseSocketClient.connect();
            const alreadySubscribed = pollingRef.current.subscribedCases;
            const toSubscribe = caseNumbers.filter(caseNumber => !alreadySubscribed.has(caseNumber.toUpperCase()));
            if (toSubscribe.length > 0) {
                zipCaseSocketClient.subscribe('case', toSubscribe);
                toSubscribe.forEach(caseNumber => alreadySubscribed.add(caseNumber.toUpperCase()));
            }
        } catch (error) {
            console.error('Failed to connect case WebSocket:', error);
        }
    }, [queryClient, upsertSocketResult]);

    // Start polling if it's not already active
    const startPolling = useCallback(() => {
        const isNewlyStarted = !pollingRef.current.active;
        pollingRef.current.active = true;
        void pollNonTerminalCases();
        return isNewlyStarted;
    }, [pollNonTerminalCases]);

    // Stop polling if it's active
    const stopPolling = useCallback(() => {
        if (pollingRef.current.active) {
            const subjects = Array.from(pollingRef.current.subscribedCases);
            if (subjects.length > 0) {
                zipCaseSocketClient.unsubscribe('case', subjects);
            }
            pollingRef.current.subscribedCases.clear();

            if (pollingRef.current.unsubscribeHandler) {
                pollingRef.current.unsubscribeHandler();
                pollingRef.current.unsubscribeHandler = null;
            }

            zipCaseSocketClient.disconnect();
            pollingRef.current.active = false;
            return true;
        }
        return false;
    }, []);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, [stopPolling]);

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
