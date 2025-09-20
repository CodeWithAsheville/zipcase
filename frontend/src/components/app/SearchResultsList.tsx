import SearchResult from './SearchResult';
import { useSearchResults, useConsolidatedPolling } from '../../hooks/useCaseSearch';
import { SearchResult as SearchResultType } from '../../../../shared/types';
import { useEffect, useMemo } from 'react';

type DisplayItem = SearchResultType | 'divider';

function CaseResultItem({ searchResult }: { searchResult: SearchResultType }) {
    return <SearchResult searchResult={searchResult} />;
}

export default function SearchResultsList() {
    const { data, isLoading, isError, error } = useSearchResults();

    // Extract batches and create a flat display list with dividers
    const displayItems = useMemo(() => {
        if (!data || !data.results || !data.searchBatches) {
            return [];
        }

        const items: DisplayItem[] = [];
        const seenCaseNumbers = new Set<string>();

        // Process each batch (newest first)
        data.searchBatches.forEach((batch, batchIndex) => {
            // Collect valid results from this batch first
            const batchResults: SearchResultType[] = [];
            batch.forEach(caseNumber => {
                if (!seenCaseNumbers.has(caseNumber)) {
                    const result = data.results[caseNumber];
                    if (result) {
                        batchResults.push(result);
                        seenCaseNumbers.add(caseNumber);
                    }
                }
            });

            // Only add divider and results if this batch has actual cases
            if (batchResults.length > 0) {
                // Add divider before each batch except the first (newest) AND only if we already have items
                if (batchIndex > 0 && items.length > 0) {
                    items.push('divider');
                }

                // Add all the results from this batch
                items.push(...batchResults);
            }
        });

        return items;
    }, [data]);

    // Extract just the search results for polling logic
    const searchResults = useMemo(() => {
        return displayItems.filter((item): item is SearchResultType => typeof item !== 'string');
    }, [displayItems]);

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
                        {displayItems.length > 0 ? (
                            <div className="mt-8">
                                <h3 className="text-base font-semibold text-gray-900">Search Results</h3>
                                <div className="mt-4">
                                    {displayItems.map((item, index) => (
                                        <div key={item === 'divider' ? `divider-${index}` : item.zipCase.caseNumber}>
                                            {item === 'divider' ? (
                                                <div className="relative my-6">
                                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                                        <div className="w-full border-t border-gray-300" />
                                                    </div>
                                                    <div className="relative flex justify-center">
                                                        <span className="bg-gray-50 px-3 text-sm text-gray-500">◇◇◇</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="mb-4">
                                                    <CaseResultItem searchResult={item} />
                                                </div>
                                            )}
                                        </div>
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
