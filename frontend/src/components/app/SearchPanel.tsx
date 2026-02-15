import React, { useReducer, useRef } from 'react';
import { MagnifyingGlassIcon, DocumentArrowUpIcon } from '@heroicons/react/24/solid';
import { useCaseSearch, useFileSearch } from '../../hooks';

interface State {
    caseNumber: string;
    error: null | string;
    feedbackMessage: null | string;
    feedbackType: 'success' | 'error' | null;
}

const initialState: State = {
    caseNumber: '',
    error: null,
    feedbackMessage: null,
    feedbackType: null,
};

type Action =
    | { type: 'SET_CASE_NUMBER'; payload: string }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_FEEDBACK'; payload: { message: string | null; type: 'success' | 'error' | null } };

const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case 'SET_CASE_NUMBER':
            return { ...state, caseNumber: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        case 'SET_FEEDBACK':
            return { ...state, feedbackMessage: action.payload.message, feedbackType: action.payload.type };
        default:
            return state;
    }
};

interface SearchPanelProps {
    onSearch?: (caseNumber: string) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ onSearch }) => {
    const [localState, localDispatch] = useReducer(reducer, initialState);
    const caseSearch = useCaseSearch();
    const fileSearch = useFileSearch();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isDragging, setIsDragging] = React.useState(false);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget === e.target) {
            setIsDragging(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Required to allow dropping
    };

    const processSelectedFile = (file: File) => {
        if (!isSupportedFileType(file)) {
            localDispatch({
                type: 'SET_ERROR',
                payload: 'Unsupported file type. Please upload a PDF, DOCX, TXT, CSV, XLSX, JPG, or PNG.',
            });
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            localDispatch({
                type: 'SET_ERROR',
                payload: `File size exceeds 10MB limit (File size: ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
            });
            return;
        }

        // Reset error and start processing
        localDispatch({ type: 'SET_ERROR', payload: null });
        localDispatch({ type: 'SET_FEEDBACK', payload: { message: 'Processing file...', type: null } });

        fileSearch.mutate(file, {
            onSuccess: data => {
                localDispatch({ type: 'SET_ERROR', payload: null });
                const caseCount = Object.keys(data?.results || {}).length;

                if (caseCount === 0) {
                    localDispatch({
                        type: 'SET_FEEDBACK',
                        payload: { message: 'No case numbers found in file', type: 'error' },
                    });
                } else {
                    localDispatch({ type: 'SET_CASE_NUMBER', payload: '' });
                    const message = caseCount === 1 ? 'Found 1 case number' : `Found ${caseCount} case numbers`;
                    localDispatch({ type: 'SET_FEEDBACK', payload: { message, type: 'success' } });
                }
            },
            onError: (error: Error) => {
                console.error('File search error:', error);
                localDispatch({ type: 'SET_ERROR', payload: error.message });
                localDispatch({ type: 'SET_FEEDBACK', payload: { message: null, type: null } });
            },
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const file = e.dataTransfer.files?.[0];
        if (!file) return;

        processSelectedFile(file);
    };

    const isSupportedFileType = (file: File) => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        const allowedExtensions = new Set(['pdf', 'txt', 'csv', 'xlsx', 'xls', 'docx', 'jpg', 'jpeg', 'png']);

        if (extension && allowedExtensions.has(extension)) {
            return true;
        }

        const allowedMimeTypes = new Set([
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
        ]);

        return allowedMimeTypes.has(file.type);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const file = e.clipboardData?.files?.[0];

        if (!file) return;

        e.preventDefault();
        processSelectedFile(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        processSelectedFile(file);

        // Reset input value to allow selecting the same file again
        e.target.value = '';
    };

    const submitSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const caseNumberInput = (e.target as HTMLFormElement).elements.namedItem('case_number') as HTMLInputElement;
        const caseNumber = caseNumberInput.value;

        if (!caseNumber.trim()) {
            localDispatch({ type: 'SET_ERROR', payload: 'Please enter a case number' });
            return;
        }

        // Use our React Query mutation to handle the search
        caseSearch.mutate(caseNumber, {
            onSuccess: data => {
                // Clear any previous error
                localDispatch({ type: 'SET_ERROR', payload: null });

                // Check if we have case count information
                const caseCount = Object.keys(data?.results || {}).length;

                if (caseCount === 0) {
                    localDispatch({
                        type: 'SET_FEEDBACK',
                        payload: {
                            message: 'No case numbers found in search text',
                            type: 'error',
                        },
                    });
                } else {
                    localDispatch({ type: 'SET_CASE_NUMBER', payload: '' });

                    const message = caseCount === 1 ? 'Found 1 case number' : `Found ${caseCount} case numbers`;
                    localDispatch({ type: 'SET_FEEDBACK', payload: { message, type: 'success' } });
                }

                caseNumberInput.focus();
            },
            onError: (error: Error) => {
                console.error('Search error:', error);
                localDispatch({ type: 'SET_ERROR', payload: error.message });
                localDispatch({ type: 'SET_FEEDBACK', payload: { message: null, type: null } });

                // Keep the input text for retry on error
                caseNumberInput.focus();
            },
        });

        if (onSearch) {
            onSearch(caseNumber);
        }

        // Input will be locked during the pending state via the disabled attribute
    };

    return (
        <>
            <div className="px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto bg-gray-100 shadow-sm rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <h3 className="text-base font-semibold text-gray-900">Case Search</h3>
                        <div className="mt-2 text-sm text-gray-500">
                            <p>
                                Enter case numbers or paste text containing case numbers.
                                <br />
                                Standard (25CR123456-789) and LexisNexis (7892025CR 123456) case numbers are supported.
                            </p>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">Tip: drop or paste a document here to search for case numbers.</div>
                        <form
                            className="mt-5 sm:flex sm:flex-col"
                            onSubmit={submitSearch}
                            onDragEnter={handleDragEnter}
                            onDragLeave={handleDragLeave}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                        >
                            <div className="w-full relative">
                                {isDragging && (
                                    <div className="absolute inset-0 bg-blue-50/95 border-2 border-dashed border-[#336699] rounded-md flex items-center justify-center z-10 pointer-events-none">
                                        <div className="text-[#336699] font-semibold text-lg flex items-center">
                                            <DocumentArrowUpIcon className="h-8 w-8 mr-2" />
                                            Drop file to process
                                        </div>
                                    </div>
                                )}
                                <textarea
                                    id="case_number"
                                    name="case_number"
                                    rows={4}
                                    aria-label="Case Numbers"
                                    className={`block w-full rounded-md px-3 py-2 text-base text-gray-900
                            outline-1 -outline-offset-1 outline-gray-300
                            placeholder:text-gray-400 resize-y
                            focus:outline-2 focus:-outline-offset-2 focus:outline-[#336699]
                            sm:text-sm/6
                            transition-colors duration-200
                            ${caseSearch.isPending || fileSearch.isPending ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                                    placeholder=""
                                    value={localState.caseNumber}
                                    onChange={e => {
                                        localDispatch({
                                            type: 'SET_CASE_NUMBER',
                                            payload: e.target.value,
                                        });

                                        // Clear feedback message when user starts typing
                                        if (localState.feedbackMessage) {
                                            localDispatch({
                                                type: 'SET_FEEDBACK',
                                                payload: { message: null, type: null },
                                            });
                                        }
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && e.ctrlKey) {
                                            e.preventDefault();
                                            if (localState.caseNumber.trim() && !caseSearch.isPending) {
                                                const form = e.currentTarget.form;
                                                if (form)
                                                    form.dispatchEvent(
                                                        new Event('submit', {
                                                            cancelable: true,
                                                            bubbles: true,
                                                        })
                                                    );
                                            }
                                        }
                                    }}
                                    onPaste={handlePaste}
                                    disabled={caseSearch.isPending || fileSearch.isPending}
                                    maxLength={50000} // limit for text input
                                />
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                                <div className="flex items-center">
                                    <button
                                        type="submit"
                                        disabled={caseSearch.isPending || fileSearch.isPending || !localState.caseNumber.trim()}
                                        className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7ABC]
                                disabled:bg-gray-400 disabled:cursor-not-allowed
                                bg-[#336699] enabled:hover:bg-[#4376a9]"
                                    >
                                        {caseSearch.isPending ? (
                                            <>
                                                <svg
                                                    className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
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
                                                Searching...
                                            </>
                                        ) : (
                                            <>
                                                <MagnifyingGlassIcon className="h-5 w-5 mr-2 text-white" aria-hidden="true" />
                                                Search
                                            </>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={caseSearch.isPending || fileSearch.isPending}
                                        className="ml-3 inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#336699] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {fileSearch.isPending ? (
                                            <>
                                                <svg
                                                    className="animate-spin -ml-1 mr-2 h-5 w-5 text-gray-500"
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
                                                Processing...
                                            </>
                                        ) : (
                                            <>
                                                <DocumentArrowUpIcon className="h-5 w-5 mr-2 text-gray-500" aria-hidden="true" />
                                                Upload File
                                            </>
                                        )}
                                    </button>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        className="hidden"
                                        accept=".pdf,application/pdf,.txt,text/plain,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.jpg,.jpeg,image/jpeg,.png,image/png"
                                    />

                                    <div className="ml-3 text-xs text-gray-500">
                                        <span className="hidden sm:inline">or press </span>
                                        <kbd className="px-1.5 py-0.5 text-xs font-semibold border border-gray-300 rounded-md bg-gray-50">
                                            Ctrl+Enter
                                        </kbd>
                                    </div>
                                </div>

                                {/* Feedback message in lower right corner of container */}
                                {localState.feedbackMessage && (
                                    <div
                                        className={`text-xs font-medium ${
                                            localState.feedbackType === 'error' ? 'text-red-600' : 'text-gray-500'
                                        }`}
                                    >
                                        {localState.feedbackMessage}
                                    </div>
                                )}
                            </div>
                        </form>
                        {localState.error && <div className="mt-2 text-sm text-red-600">{localState.error}</div>}
                    </div>
                </div>
            </div>
        </>
    );
};

export default SearchPanel;
