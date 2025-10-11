import React from 'react';
import type { SearchResult as SearchResultType } from '../../../../shared/types';
import { parseDateString, formatDisplayDate } from '../../../../shared/DateTimeUtils';
import SearchStatus from './SearchStatus';
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { PORTAL_CASE_URL } from '../../aws-exports';
import { useRemoveCase } from '../../hooks/useCaseSearch';

interface SearchResultProps {
    searchResult: SearchResultType;
}

const SearchResult: React.FC<SearchResultProps> = ({ searchResult: sr }) => {
    const removeCase = useRemoveCase();
    // Add a safety check to ensure we have a properly structured case object
    if (!sr?.zipCase?.caseNumber) {
        console.error('Invalid case object received by SearchResult:', sr);
        return null;
    }

    const { zipCase: c, caseSummary: summary } = sr;

    const handleRemove = () => {
        removeCase(c.caseNumber);
    };

    return (
        <div className="bg-white rounded-lg shadow overflow-hidden border-t border-gray-100 relative group">
            {/* Remove button - appears in upper right corner */}
            <button
                onClick={handleRemove}
                className="absolute top-2 right-2 p-1.5 text-gray-300 hover:text-gray-700 hover:bg-gray-200 hover:shadow-sm rounded transition-all group-hover:text-gray-400 focus:text-gray-700 focus:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
                aria-label="Remove case from results"
                title="Remove case from results"
            >
                <XMarkIcon className="h-5 w-5" />
            </button>
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
                                    {summary.arrestOrCitationDate &&
                                        (() => {
                                            const d = parseDateString(summary.arrestOrCitationDate);
                                            if (d) {
                                                const label =
                                                    summary.arrestOrCitationType === 'Arrest'
                                                        ? 'Arrest Date:'
                                                        : summary.arrestOrCitationType === 'Citation'
                                                          ? 'Citation Date:'
                                                          : 'Arrest/Citation Date:';

                                                return (
                                                    <p className="mt-1 text-sm text-gray-600">
                                                        <span className="font-medium">{label}</span> {formatDisplayDate(d)}
                                                    </p>
                                                );
                                            }
                                            return null;
                                        })()}

                                    {/* Filing agency: shown at top-level if the case summary has a single filing agency for all charges */}
                                    {summary.filingAgency && (
                                        <p className="mt-1 text-sm text-gray-600">
                                            <span className="font-medium">Filing Agency:</span> {summary.filingAgency}
                                        </p>
                                    )}
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
                                                            <span className="font-medium">Filed:</span>{' '}
                                                            {(() => {
                                                                const d = parseDateString(charge.filedDate);
                                                                return d ? formatDisplayDate(d) : '';
                                                            })()}
                                                        </div>
                                                        <div>
                                                            <span className="font-medium">Offense:</span>{' '}
                                                            {(() => {
                                                                const d = parseDateString(charge.offenseDate);
                                                                return d ? formatDisplayDate(d) : '';
                                                            })()}
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

                                                        {/* Per-charge filing agency: only shown when no top-level filing agency is present */}
                                                        {!summary.filingAgency && charge.filingAgency && (
                                                            <div>
                                                                <span className="font-medium">Filing Agency:</span> {charge.filingAgency}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {charge.dispositions && charge.dispositions.length > 0 && (
                                                        <div className="mt-2 text-xs text-gray-600">
                                                            <span className="font-medium">Disposition:</span>{' '}
                                                            {charge.dispositions[0].description} (
                                                            {(() => {
                                                                const dispDate = charge.dispositions[0].date;
                                                                const d = parseDateString(dispDate);
                                                                return d ? formatDisplayDate(d) : '';
                                                            })()}
                                                            )
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
