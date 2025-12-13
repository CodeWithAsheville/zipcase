import SearchResult from './SearchResult';
import { useSearchResults, useConsolidatedPolling } from '../../hooks/useCaseSearch';
import { SearchResult as SearchResultType } from '../../../../shared/types';
import { useEffect, useMemo, useState, useRef } from 'react';
import { ArrowDownTrayIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { ZipCaseClient } from '../../services/ZipCaseClient';

type DisplayItem = SearchResultType | 'divider';

function CaseResultItem({ searchResult }: { searchResult: SearchResultType }) {
    return <SearchResult searchResult={searchResult} />;
}

export default function SearchResultsList() {
    const { data, isLoading, isError, error } = useSearchResults();

    const [copied, setCopied] = useState(false);
    const copiedTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [isExporting, setIsExporting] = useState(false);

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

    // Function to copy all case numbers to clipboard
    const copyCaseNumbers = async () => {
        if (!searchResults || searchResults.length === 0) {
            return;
        }

        // Extract case numbers, sort them alphanumerically, and join with newlines
        const caseNumbers = searchResults
            .map(result => result.zipCase.caseNumber)
            .sort()
            .join('\n');

        try {
            await navigator.clipboard.writeText(caseNumbers);
            setCopied(true);

            // Clear any existing timeout
            if (copiedTimeoutRef.current) {
                clearTimeout(copiedTimeoutRef.current);
            }

            // Reset copied state after 2 seconds
            copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy case numbers:', err);
        }
    };

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

    // Clean up timeout on unmount
    useEffect(() => {
        return () => {
            if (copiedTimeoutRef.current) {
                clearTimeout(copiedTimeoutRef.current);
            }
        };
    }, []);

    const handleExport = async () => {
        const caseNumbers = searchResults.map(r => r.zipCase.caseNumber);
        if (caseNumbers.length === 0) return;

        setIsExporting(true);

        // Set a timeout to reset the exporting state after 10 seconds
        const timeoutId = setTimeout(() => {
            setIsExporting(false);
        }, 10000);

        try {
            const client = new ZipCaseClient();
            await client.cases.export(caseNumbers);
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            clearTimeout(timeoutId);
            setIsExporting(false);
        }
    };

    const isExportEnabled = useMemo(() => {
        if (searchResults.length === 0) return false;
        const terminalStates = ['complete', 'failed', 'notFound'];
        return searchResults.every(r => terminalStates.includes(r.zipCase.fetchStatus.status));
    }, [searchResults]);

    const exportableCount = useMemo(() => {
        return searchResults.filter(r => r.zipCase.fetchStatus.status !== 'notFound').length;
    }, [searchResults]);

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
                                <div className="flex justify-between items-center">
                                    <h3 className="text-base font-semibold text-gray-900">Search Results</h3>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={handleExport}
                                            disabled={!isExportEnabled || isExporting}
                                            className={`inline-flex items-center gap-x-1.5 rounded-md px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset ${
                                                isExportEnabled && !isExporting
                                                    ? 'bg-white text-gray-900 ring-gray-300 hover:bg-gray-50'
                                                    : 'bg-gray-100 text-gray-400 ring-gray-200 cursor-not-allowed'
                                            }`}
                                            title={
                                                isExportEnabled
                                                    ? `Export ${exportableCount} case${exportableCount === 1 ? '' : 's'}`
                                                    : 'Wait for all cases to finish processing before exporting'
                                            }
                                        >
                                            {isExporting ? (
                                                <svg
                                                    className="animate-spin -ml-0.5 h-5 w-5 text-gray-400"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <circle
                                                        className="opacity-25"
                                                        cx="12"
                                                        cy="12"
                                                        r="10"
                                                        stroke="currentColor"
                                                        strokeWidth="4"
                                                    ></circle>
                                                    <path
                                                        className="opacity-75"
                                                        fill="currentColor"
                                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                    ></path>
                                                </svg>
                                            ) : (
                                                <ArrowDownTrayIcon
                                                    className={`-ml-0.5 h-5 w-5 ${isExportEnabled ? 'text-gray-400' : 'text-gray-300'}`}
                                                    aria-hidden="true"
                                                />
                                            )}
                                            Export
                                        </button>
                                        <button
                                            onClick={copyCaseNumbers}
                                            className={`inline-flex items-center gap-x-2 rounded-md bg-white px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset hover:bg-gray-50 ${
                                                copied ? 'text-green-700 ring-green-600' : 'text-gray-900 ring-gray-300'
                                            }`}
                                            aria-label="Copy all case numbers"
                                        >
                                            {copied ? (
                                                <CheckIcon className="h-5 w-5 text-green-600" aria-hidden="true" />
                                            ) : (
                                                <ClipboardDocumentIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                            )}
                                            Copy Case Numbers
                                        </button>
                                    </div>
                                </div>
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
