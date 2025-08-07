import React from 'react';
import { Puff } from 'react-loader-spinner';
import {
    CheckCircleIcon,
    ClockIcon,
    ExclamationCircleIcon,
    XCircleIcon,
} from '@heroicons/react/24/solid';
import { FetchStatus } from '../../../../shared/types';

interface SearchStatusProps {
    status: FetchStatus;
}

const renderStatusIcon = (icon: React.ReactNode) => {
    return (
        <div className="flex items-center justify-center">
            <div className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full">
                {icon}
            </div>
        </div>
    );
};

const renderSearchStatus = (status: FetchStatus) => {
    switch (status.status) {
        case 'processing':
            return renderStatusIcon(
                <div title="processing" aria-label="processing">
                    <Puff height="100%" width="100%" color="#4fa94d" ariaLabel="puff-loading" />
                </div>
            );
        case 'queued':
            return renderStatusIcon(
                <ClockIcon className="text-gray-300" title="queued" aria-label="queued" />
            );
        case 'failed':
            return renderStatusIcon(
                <ExclamationCircleIcon
                    className="text-red-600"
                    title="failed"
                    aria-label="failed"
                />
            );
        case 'notFound':
            return renderStatusIcon(
                <XCircleIcon className="text-gray-600" title="not found" aria-label="not found" />
            );
        case 'found':
            return renderStatusIcon(
                <CheckCircleIcon
                    className="text-yellow-500"
                    title="case found"
                    aria-label="case found"
                />
            );
        case 'complete':
            return renderStatusIcon(
                <CheckCircleIcon
                    className="text-green-600"
                    title="complete"
                    aria-label="complete"
                />
            );
        default:
            return null;
    }
};

const SearchStatus: React.FC<SearchStatusProps> = ({ status }) => {
    return renderSearchStatus(status);
};

export default SearchStatus;
