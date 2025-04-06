import React, { useReducer, useState, useRef, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { useNameSearch } from '../../hooks';
import { formatDate, parseDate } from '../../utils/dateParser';

interface State {
    name: string;
    dateOfBirth: string;
    formattedDate: string;
    soundsLike: boolean;
    error: null | string;
}

const initialState: State = {
    name: '',
    dateOfBirth: '',
    formattedDate: '',
    soundsLike: false,
    error: null,
};

type Action =
    | { type: 'SET_NAME'; payload: string }
    | { type: 'SET_DATE_OF_BIRTH'; payload: string }
    | { type: 'SET_FORMATTED_DATE'; payload: string }
    | { type: 'SET_SOUNDS_LIKE'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null };

const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case 'SET_NAME':
            return { ...state, name: action.payload };
        case 'SET_DATE_OF_BIRTH':
            return { ...state, dateOfBirth: action.payload };
        case 'SET_FORMATTED_DATE':
            return { ...state, formattedDate: action.payload };
        case 'SET_SOUNDS_LIKE':
            return { ...state, soundsLike: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        default:
            return state;
    }
};

interface NameSearchPanelProps {
    onSearch?: (name: string, dateOfBirth?: string, soundsLike?: boolean) => void;
}

const NameSearchPanel: React.FC<NameSearchPanelProps> = ({ onSearch }) => {
    const [localState, localDispatch] = useReducer(reducer, initialState);
    const nameSearch = useNameSearch();
    const [soundsLikeTooltipVisible, setSoundsLikeTooltipVisible] = useState(false);
    const soundsLikeTooltipRef = useRef<HTMLDivElement>(null);
    const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Close tooltip when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                soundsLikeTooltipRef.current &&
                !soundsLikeTooltipRef.current.contains(event.target as Node)
            ) {
                if (soundsLikeTooltipVisible) {
                    setSoundsLikeTooltipVisible(false);
                }
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [soundsLikeTooltipVisible]);

    // Cleanup validation timeout on unmount
    useEffect(() => {
        return () => {
            if (validationTimeoutRef.current) {
                clearTimeout(validationTimeoutRef.current);
            }
        };
    }, []);

    // We're using validationTimeoutRef defined above

    const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        localDispatch({ type: 'SET_DATE_OF_BIRTH', payload: inputValue });

        // Clear any existing timeout
        if (validationTimeoutRef.current) {
            clearTimeout(validationTimeoutRef.current);
            validationTimeoutRef.current = null;
        }

        // Always clear formatted date and error when typing
        if (inputValue.trim() === '') {
            localDispatch({ type: 'SET_FORMATTED_DATE', payload: '' });
            localDispatch({ type: 'SET_ERROR', payload: null });
            return;
        }

        // For numeric input, validate immediately
        if (/^\d+$/.test(inputValue) || /^\d+[/\-.]\d+[/\-.]\d+$/.test(inputValue)) {
            validateDate(inputValue);
        } else {
            // For text input (like month names), delay validation to allow typing
            validationTimeoutRef.current = setTimeout(() => {
                validateDate(inputValue);
            }, 800); // 800ms delay
        }
    };

    const validateDate = (inputValue: string) => {
        if (!inputValue.trim()) return;

        try {
            const parsedDate = parseDate(inputValue);
            if (parsedDate) {
                const formatted = formatDate(parsedDate);
                localDispatch({ type: 'SET_FORMATTED_DATE', payload: formatted });
                localDispatch({ type: 'SET_ERROR', payload: null });
            } else {
                localDispatch({ type: 'SET_FORMATTED_DATE', payload: '' });
                // Check if input might be just month and day without year
                const monthDayPattern =
                    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)(\s+\d{1,2})?$|^\d{1,2}[/\-.]\d{1,2}$/i;
                if (monthDayPattern.test(inputValue.trim())) {
                    localDispatch({ type: 'SET_ERROR', payload: 'Year is required' });
                } else {
                    localDispatch({ type: 'SET_ERROR', payload: 'Invalid date format' });
                }
            }
        } catch {
            localDispatch({ type: 'SET_FORMATTED_DATE', payload: '' });
            localDispatch({ type: 'SET_ERROR', payload: 'Invalid date format' });
        }
    };

    const submitSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Validate input
        if (!localState.name.trim()) {
            localDispatch({ type: 'SET_ERROR', payload: 'Please enter a name' });
            return;
        }

        // If date of birth is provided but invalid, prevent submission
        if (localState.dateOfBirth.trim() && !localState.formattedDate) {
            localDispatch({ type: 'SET_ERROR', payload: 'Please enter a valid date of birth' });
            return;
        }

        // Get the ISO format date if available
        const parsedDate = localState.dateOfBirth.trim()
            ? parseDate(localState.dateOfBirth)?.toISOString().split('T')[0]
            : undefined;

        // Use our React Query mutation to handle the search
        nameSearch.mutate(
            {
                name: localState.name,
                dateOfBirth: parsedDate,
                soundsLike: localState.soundsLike,
            },
            {
                onSuccess: data => {
                    // Clear any previous error
                    localDispatch({ type: 'SET_ERROR', payload: null });
                    // Only clear the input fields on success
                    localDispatch({ type: 'SET_NAME', payload: '' });
                    localDispatch({ type: 'SET_DATE_OF_BIRTH', payload: '' });
                    localDispatch({ type: 'SET_FORMATTED_DATE', payload: '' });
                    // Keep sounds like checkbox state
                },
                onError: (error: Error) => {
                    console.error('Name search error:', error);
                    localDispatch({ type: 'SET_ERROR', payload: error.message });
                },
            }
        );

        if (onSearch) {
            onSearch(
                localState.name,
                parsedDate,
                localState.soundsLike
            );
        }

        // Input will be locked during the pending state via the disabled attribute
    };

    return (
        <>
            <div className="px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto bg-gray-100 shadow-sm rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <h3 className="text-base font-semibold text-gray-900">Name Search</h3>
                        <form className="mt-5 sm:flex sm:flex-col" onSubmit={submitSearch}>
                            <div className="w-full space-y-4">
                                {/* Name input */}
                                <div>
                                    <label
                                        htmlFor="name_input"
                                        className="block text-sm font-medium text-gray-700 mb-1"
                                    >
                                        Name
                                    </label>
                                    <input
                                        id="name_input"
                                        name="name_input"
                                        type="text"
                                        placeholder="Last, First Middle"
                                        aria-label="Name"
                                        className={`block w-full rounded-md px-3 py-2 text-base text-gray-900
                                            outline-1 -outline-offset-1 outline-gray-300
                                            placeholder:text-gray-400
                                            focus:outline-2 focus:-outline-offset-2 focus:outline-[#336699]
                                            sm:text-sm/6
                                            ${nameSearch.isPending ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                                        value={localState.name}
                                        onChange={e =>
                                            localDispatch({
                                                type: 'SET_NAME',
                                                payload: e.target.value,
                                            })
                                        }
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && e.ctrlKey) {
                                                e.preventDefault();
                                                if (
                                                    localState.name.trim() &&
                                                    !nameSearch.isPending &&
                                                    (!localState.dateOfBirth.trim() || localState.formattedDate)
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
                                        disabled={nameSearch.isPending}
                                    />
                                </div>

                                {/* Sounds Like checkbox */}
                                <div className="flex items-center -mt-2">
                                    <input
                                        id="sounds_like"
                                        name="sounds_like"
                                        type="checkbox"
                                        className="h-4 w-4 text-[#336699] focus:ring-[#336699] border-gray-300 rounded"
                                        checked={localState.soundsLike}
                                        onChange={e =>
                                            localDispatch({
                                                type: 'SET_SOUNDS_LIKE',
                                                payload: e.target.checked,
                                            })
                                        }
                                        disabled={nameSearch.isPending}
                                    />
                                    <label
                                        htmlFor="sounds_like"
                                        className="ml-2 block text-sm text-gray-700"
                                    >
                                        Sounds like
                                    </label>

                                    {/* Info tooltip */}
                                    <div className="relative ml-2 flex items-center">
                                        <button
                                            type="button"
                                            onClick={() => setSoundsLikeTooltipVisible(!soundsLikeTooltipVisible)}
                                            className="text-gray-500 hover:text-gray-700 flex items-center"
                                            aria-label="Sounds like information"
                                        >
                                            <InformationCircleIcon className="h-5 w-5" />
                                        </button>
                                        {soundsLikeTooltipVisible && (
                                            <div
                                                ref={soundsLikeTooltipRef}
                                                className="absolute z-30 w-80 p-2 mt-2 text-sm text-left text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg -left-28 top-6"
                                            >
                                                Use phonetic matching to find names that sound similar but may be
                                                spelled differently (e.g., "Smith" will match "Smyth").
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Date of Birth input */}
                                <div>
                                    <label
                                        htmlFor="dob_input"
                                        className="block text-sm font-medium text-gray-700 mb-1"
                                    >
                                        Date of Birth (optional)
                                    </label>
                                    <input
                                        id="dob_input"
                                        name="dob_input"
                                        type="text"
                                        placeholder="(any date format)"
                                        aria-label="Date of Birth"
                                        className={`block w-full rounded-md px-3 py-2 text-base text-gray-900
                                            outline-1 -outline-offset-1 outline-gray-300
                                            placeholder:text-gray-400
                                            focus:outline-2 focus:-outline-offset-2 focus:outline-[#336699]
                                            sm:text-sm/6
                                            ${nameSearch.isPending ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                                        value={localState.dateOfBirth}
                                        onChange={handleDateInputChange}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && e.ctrlKey) {
                                                e.preventDefault();
                                                if (
                                                    localState.name.trim() &&
                                                    !nameSearch.isPending &&
                                                    (!localState.dateOfBirth.trim() || localState.formattedDate)
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
                                        disabled={nameSearch.isPending}
                                    />
                                    {localState.formattedDate ? (
                                        <div className="mt-1 text-sm text-gray-600 pl-3">
                                            {localState.formattedDate}
                                        </div>
                                    ) : localState.error ? (
                                        <div className="mt-1 text-sm text-red-600 pl-3">
                                            {localState.error}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className="mt-4 flex items-center">
                                <button
                                    type="submit"
                                    disabled={
                                        nameSearch.isPending ||
                                        !localState.name.trim() ||
                                        (localState.dateOfBirth.trim() && !localState.formattedDate)
                                    }
                                    className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7ABC]
                                    disabled:bg-gray-400 disabled:cursor-not-allowed
                                    bg-[#336699] enabled:hover:bg-[#4376a9]"
                                >
                                    {nameSearch.isPending ? (
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
                    </div>
                </div>
            </div>
        </>
    );
};

export default NameSearchPanel;
