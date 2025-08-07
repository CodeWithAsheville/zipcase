import React from 'react';
import type { SearchResult as SearchResultType } from '../../../../shared/types';
import SearchStatus from './SearchStatus';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { PORTAL_CASE_URL } from '../../aws-exports';

interface SearchResultProps {
    searchResult: SearchResultType;
}

const SearchResult: React.FC<SearchResultProps> = ({ searchResult: sr }) => {
    // Add a safety check to ensure we have a properly structured case object
    if (!sr?.zipCase?.caseNumber) {
        console.error('Invalid case object received by SearchResult:', sr);
        return null;
    }

    const { zipCase: c, caseSummary: summary } = sr;

    return (
        <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 sm:p-6">
                <div className="flex items-start">
                    <div className="flex-shrink-0 mr-4">
                        <SearchStatus status={c.fetchStatus} />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                            <div className="mb-2 sm:mb-0">
                                {c.caseId ? (
                                    <div className="inline-flex font-medium text-primary-dark underline">
                                        <a
                                            href={`${PORTAL_CASE_URL}/#/${c.caseId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-primary"
                                        >
                                            {c.caseNumber}
                                        </a>
                                        <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-1 text-gray-500" />
                                    </div>
                                ) : (
                                    <div className="font-medium text-gray-600">{c.caseNumber}</div>
                                )}
                            </div>

                            {/* {c.lastUpdated && (
                                <div className="text-sm text-gray-500">
                                    Last Updated: {new Date(c.lastUpdated).toLocaleDateString()}
                                </div>
                            )} */}
                        </div>

                        {/* Display error message for failed cases */}
                        {c.fetchStatus.status === 'failed' && c.fetchStatus.message && (
                            <div className="mt-2">
                                <p className="text-sm text-red-600">{c.fetchStatus.message}</p>
                            </div>
                        )}

                        {summary && (
                            <div className="mt-4 space-y-4">
                                <div className="text-sm text-gray-700">
                                    <p className="font-medium">{summary.caseName}</p>
                                    <p>{summary.court}</p>
                                </div>

                                {summary.charges && summary.charges.length > 0 && (
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-medium text-gray-700">Charges</h4>
                                        {summary.charges.map((charge, idx) => (
                                            <div key={idx} className="pl-2 border-l-2 border-gray-200">
                                                <div className="text-sm text-gray-800">
                                                    <div className="font-medium mb-1">{charge.description}</div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                                                        <div>
                                                            <span className="font-medium">Filed:</span> {new Date(charge.filedDate).toLocaleDateString()}
                                                        </div>
                                                        <div>
                                                            <span className="font-medium">Offense:</span> {new Date(charge.offenseDate).toLocaleDateString()}
                                                        </div>
                                                        <div>
                                                            <span className="font-medium">Statute:</span> {charge.statute}
                                                        </div>
                                                        <div>
                                                            <span className="font-medium">Degree:</span> {charge.degree.description}
                                                        </div>
                                                        {charge.fine > 0 && (
                                                            <div>
                                                                <span className="font-medium">Fine:</span> ${charge.fine.toFixed(2)}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {charge.dispositions && charge.dispositions.length > 0 && (
                                                        <div className="mt-2">
                                                            <p className="text-xs font-medium mb-1">Dispositions:</p>
                                                            {charge.dispositions.map((d, i) => (
                                                                <div key={i} className="text-xs text-gray-500 ml-2">
                                                                    {d.description} ({new Date(d.date).toLocaleDateString()})
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SearchResult;
