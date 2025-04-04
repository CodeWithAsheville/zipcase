import React, { useReducer } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { useCaseSearch } from '../../hooks';

interface State {
    caseNumber: string;
    error: null | string;
}

const initialState: State = {
    caseNumber: '',
    error: null,
};

type Action =
    | { type: 'SET_CASE_NUMBER'; payload: string }
    | { type: 'SET_ERROR'; payload: string | null };

const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case 'SET_CASE_NUMBER':
            return { ...state, caseNumber: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
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

    const submitSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const caseNumberInput = (e.target as HTMLFormElement).elements.namedItem(
            'case_number'
        ) as HTMLInputElement;
        const caseNumber = caseNumberInput.value;

        if (!caseNumber.trim()) {
            localDispatch({ type: 'SET_ERROR', payload: 'Please enter a case number' });
            return;
        }

        console.log('Initiating search for:', caseNumber);

        // Use our React Query mutation to handle the search
        caseSearch.mutate(caseNumber, {
            onSuccess: data => {
                console.log('Search completed successfully in SearchPanel:', data);
                // Clear any previous error
                localDispatch({ type: 'SET_ERROR', payload: null });
                // Only clear the input field on success
                localDispatch({ type: 'SET_CASE_NUMBER', payload: '' });
                caseNumberInput.focus();
            },
            onError: (error: Error) => {
                console.error('Search error:', error);
                localDispatch({ type: 'SET_ERROR', payload: error.message });
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
                <div className="max-w-4xl mx-auto bg-gray-100 shadow-sm sm:rounded-lg">
                    <div className="px-4 sm:p-6">
                        <h3 className="text-base font-semibold text-gray-900">Case Search</h3>
                        <div className="mt-2 text-sm text-gray-500">
                            <p>
                                Enter case numbers or paste text containing case numbers.
                                <br />
                                Standard (25CR123456-789) and LexisNexis (7892025CR 123456) case
                                numbers are supported.
                            </p>
                        </div>
                        <form className="mt-5 sm:flex sm:flex-col" onSubmit={submitSearch}>
                            <div className="w-full">
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
                            ${caseSearch.isPending ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                                    value={localState.caseNumber}
                                    onChange={e =>
                                        localDispatch({
                                            type: 'SET_CASE_NUMBER',
                                            payload: e.target.value,
                                        })
                                    }
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && e.ctrlKey) {
                                            e.preventDefault();
                                            if (
                                                localState.caseNumber.trim() &&
                                                !caseSearch.isPending
                                            ) {
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
                                    disabled={caseSearch.isPending}
                                    maxLength={5000} // Reasonable limit for text input
                                />
                            </div>
                            <div className="mt-3 flex items-center">
                                <button
                                    type="submit"
                                    disabled={caseSearch.isPending || !localState.caseNumber.trim()}
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
                                            <MagnifyingGlassIcon
                                                className="h-5 w-5 mr-2 text-white"
                                                aria-hidden="true"
                                            />
                                            Search
                                        </>
                                    )}
                                </button>
                                <div className="ml-3 text-xs text-gray-500">
                                    <span className="hidden sm:inline">or press </span>
                                    <kbd className="px-1.5 py-0.5 text-xs font-semibold border border-gray-300 rounded-md bg-gray-50">
                                        Ctrl+Enter
                                    </kbd>
                                </div>
                            </div>
                        </form>
                        {localState.error && (
                            <div className="mt-2 text-sm text-red-600">{localState.error}</div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default SearchPanel;
