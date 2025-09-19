import SearchResult from './SearchResult';
import { useSearchResults, useConsolidatedPolling } from '../../hooks/useCaseSearch';
import { SearchResult as SearchResultType } from '../../../../shared/types';
import { useEffect, useMemo } from 'react';

// Individual case result component - no polling here, just display
function CaseResultItem({ searchResult }: { searchResult: SearchResultType }) {
    return <SearchResult searchResult={searchResult} />;
}

export default function SearchResultsList() {
    const { data, isLoading, isError, error } = useSearchResults();

    // Extract ordered results based on batches (newest searches first)
    const searchResults = useMemo(() => {
        if (!data || !data.results || !data.searchBatches) {
            return [];
        }

        // Flatten batches while maintaining batch order
        const orderedCaseNumbers: string[] = [];
        const seenCaseNumbers = new Set<string>();

        // Process each batch (newest first)
        data.searchBatches.forEach(batch => {
            batch.forEach(caseNumber => {
                // Only add case numbers we haven't seen yet to avoid duplicates
                if (!seenCaseNumbers.has(caseNumber)) {
                    orderedCaseNumbers.push(caseNumber);
                    seenCaseNumbers.add(caseNumber);
                }
            });
        });

        // Map ordered case numbers to their result objects
        return orderedCaseNumbers.map(caseNumber => data.results[caseNumber]).filter(Boolean); // Remove any undefined entries
    }, [data]);

    // Use the consolidated polling approach for all non-terminal cases
    const polling = useConsolidatedPolling();

    // Start/stop polling based on whether we have non-terminal cases
    useEffect(() => {
        if (searchResults.length > 0) {
            // Check if we have any non-terminal cases to poll
            const terminalStates = ['complete', 'failed'];
            const hasNonTerminalCases = searchResults.some(result => {
                const status = result.zipCase.fetchStatus.status;
                return !terminalStates.includes(status);
            });

            if (hasNonTerminalCases) {
                // Start polling if we have cases to poll
                polling.startPolling();
            }
        }

        // Clean up polling on unmount
        return () => {
            polling.stopPolling();
        };
    }, [searchResults, polling]);

    if (isError) {
        console.error('Error in useSearchResults:', error);
    }

    return (
        <div className="px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                {isLoading ? (
                    <div className="mt-8 flex justify-center">
                        <div className="animate-pulse flex space-x-4" data-testid="loading-pulse">
                            <div className="h-12 w-12 rounded-full bg-slate-200"></div>
                            <div className="space-y-2 flex-1">
                                <div className="h-4 bg-slate-200 rounded"></div>
                                <div className="h-4 bg-slate-200 rounded w-5/6"></div>
                                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {searchResults.length > 0 ? (
                            <div className="mt-8">
                                <h3 className="text-base font-semibold text-gray-900">Search Results</h3>
                                <div className="mt-4 space-y-4">
                                    {searchResults.map(result => (
                                        <CaseResultItem key={`${result.zipCase.caseNumber}`} searchResult={result} />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
