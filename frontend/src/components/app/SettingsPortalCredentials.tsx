import React, { useReducer, useEffect, useRef } from 'react';
import {
    CheckCircleIcon,
    ArrowPathIcon,
    EyeIcon,
    EyeSlashIcon,
    ExclamationCircleIcon,
} from '@heroicons/react/24/solid';
import { Puff } from 'react-loader-spinner';
import { Text } from '../tailwind';
import useZipCaseApi from '../../hooks/useZipCaseApi';
import { useMutation, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { PortalCredentialsResponse } from '../../../../shared/types';

type CredentialValidationState =
    | { status: 'idle' }
    | { status: 'validating' }
    | { status: 'succeeded' }
    | { status: 'failed'; errorMessage: string }
    | { status: 'invalid' };

interface SettingsPortalCredentialsProps {
    portalCredentials: UseQueryResult<PortalCredentialsResponse | null, Error>;
}

interface State {
    username: string;
    password: string;
    showPassword: boolean;
    validationState: CredentialValidationState;
}

type Action =
    | { type: 'SET_USERNAME'; payload: string }
    | { type: 'SET_PASSWORD'; payload: string }
    | { type: 'TOGGLE_SHOW_PASSWORD' }
    | { type: 'SET_VALIDATION_STATE'; payload: CredentialValidationState }
    | { type: 'RESET_STATE'; payload: string | null }
    | { type: 'SET_CREDENTIAL_STATE'; username: string; isBad: boolean };

const initialUsername = '';

const initialState = (): State => ({
    username: initialUsername,
    password: '',
    showPassword: false,
    validationState: { status: 'idle' },
});

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'SET_USERNAME':
            return {
                ...state,
                username: action.payload,
                validationState:
                    state.validationState.status !== 'idle' &&
                    state.validationState.status !== 'invalid'
                        ? { status: 'idle' }
                        : state.validationState,
            };
        case 'SET_PASSWORD':
            return {
                ...state,
                password: action.payload,
                validationState:
                    state.validationState.status !== 'idle' &&
                    state.validationState.status !== 'invalid'
                        ? { status: 'idle' }
                        : state.validationState,
            };
        case 'TOGGLE_SHOW_PASSWORD':
            return { ...state, showPassword: !state.showPassword };
        case 'SET_VALIDATION_STATE':
            return {
                ...state,
                validationState: action.payload,
                showPassword: action.payload.status === 'validating' ? false : state.showPassword,
            };
        case 'RESET_STATE': {
            const initial = initialState();
            return {
                ...initial,
                username: action.payload ?? initial.username,
            };
        }
        case 'SET_CREDENTIAL_STATE':
            return {
                ...state,
                username: action.username,
                validationState: action.isBad ? { status: 'invalid' } : { status: 'idle' },
            };
        default:
            return state;
    }
}

const renderCredentialsValidationState = (validationState: CredentialValidationState) => {
    switch (validationState.status) {
        case 'validating':
            return (
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8">
                        <Puff height="100%" width="100%" color="#4fa94d" ariaLabel="puff-loading" />
                    </div>
                    <Text>Checking your credentials…</Text>
                </div>
            );
        case 'succeeded':
            return (
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 flex items-center">
                        <CheckCircleIcon className="text-green-600" />
                    </div>
                    <Text>Credentials validated and saved successfully</Text>
                </div>
            );
        case 'failed': {
            const { errorMessage: msg } = validationState;
            return (
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8">
                        <ExclamationCircleIcon className="text-red-600" />
                    </div>
                    <Text>{msg}</Text>
                </div>
            );
        }
        case 'invalid':
            return (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-4 w-full">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <ExclamationCircleIcon
                                className="h-5 w-5 text-yellow-400"
                                aria-hidden="true"
                            />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-yellow-700">
                                Your credentials appear to be invalid. Please update them to
                                continue accessing court portal data.
                            </p>
                        </div>
                    </div>
                </div>
            );
        case 'idle':
        default:
            return null;
    }
};

const SettingsPortalCredentials: React.FC<SettingsPortalCredentialsProps> = ({
    portalCredentials: credentialsQuery,
}) => {
    const { data, isLoading, error, status } = credentialsQuery;
    const originalCredentialsRef = useRef<{ username: string; isBad: boolean } | null>(null);
    const [state, dispatch] = useReducer(reducer, initialState());
    const queryClient = useQueryClient();

    // Update state when credentials are loaded from React Query
    useEffect(() => {
        if (!isLoading) {
            if (data) {
                // Store original credentials from API
                originalCredentialsRef.current = {
                    username: data.username || '',
                    isBad: data.isBad || false,
                };

                // Update state with fetched credentials
                dispatch({
                    type: 'SET_CREDENTIAL_STATE',
                    username: data.username || '',
                    isBad: data.isBad || false,
                });
            } else if (status === 'error' && error) {
                console.error('Error loading credentials:', error);
                dispatch({
                    type: 'SET_VALIDATION_STATE',
                    payload: {
                        status: 'failed',
                        errorMessage: error.message,
                    },
                });
            }
        }
    }, [data, isLoading, error, status]);

    const savePortalCredentials = useZipCaseApi(client =>
        client.credentials.set({
            username: state.username,
            password: state.password,
        })
    ).callApi;

    // Create a mutation for saving credentials
    const saveCredentialsMutation = useMutation({
        mutationFn: async () => {
            await savePortalCredentials();
        },
        onMutate: () => {
            dispatch({ type: 'SET_VALIDATION_STATE', payload: { status: 'validating' } });
        },
        onSuccess: () => {
            console.log('Credentials saved successfully');
            dispatch({
                type: 'SET_VALIDATION_STATE',
                payload: { status: 'succeeded' },
            });

            queryClient.setQueryData(['credentials'], {
                username: state.username,
                isBad: false,
            });
        },
        onError: (error: Error) => {
            console.error('Error saving credentials:', error);
            dispatch({
                type: 'SET_VALIDATION_STATE',
                payload: {
                    status: 'failed',
                    errorMessage: error.message || 'Failed to save credentials',
                },
            });
        },
    });

    const isSubmitEnabled =
        state.username.trim() !== '' &&
        state.password.trim() !== '' &&
        (state.validationState.status === 'idle' || state.validationState.status === 'invalid');

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveCredentialsMutation.mutate();
    };

    if (isLoading) {
        return (
            <div className="space-y-12 border-b border-gray-200 pb-12">
                <h2 className="text-base/7 font-semibold text-gray-900">
                    Court Portal Credentials
                </h2>
                <div className="ml-6 flex items-center">
                    <div className="w-8 h-8">
                        <Puff height="100%" width="100%" color="#4fa94d" ariaLabel="puff-loading" />
                    </div>
                    <Text>Loading credentials...</Text>
                </div>
            </div>
        );
    }

    return (
        <>
            <form onSubmit={handleSubmit}>
                <div className="space-y-12 border-b border-gray-200 pb-12">
                    <h2 className="text-base/7 font-semibold text-gray-900">
                        Court Portal Credentials
                    </h2>
                    <div className="ml-6">
                        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-6">
                            <div className="sm:col-span-3 xl:col-span-2">
                                <label
                                    htmlFor="username"
                                    className="block text-sm/6 font-medium text-gray-700"
                                >
                                    Username
                                </label>
                                <div className="mt-2">
                                    <div className="flex items-center rounded-md outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary overflow-hidden">
                                        <input
                                            id="username"
                                            name="username"
                                            type="text"
                                            value={state.username}
                                            onChange={e =>
                                                dispatch({
                                                    type: 'SET_USERNAME',
                                                    payload: e.target.value,
                                                })
                                            }
                                            placeholder="janedoe@legalaid.org"
                                            className="block min-w-0 grow py-1.5 px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6 w-full"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="sm:col-span-3 xl:col-span-2">
                                <label
                                    htmlFor="password"
                                    className="block text-sm/6 font-medium text-gray-700"
                                >
                                    Password
                                </label>
                                <div className="mt-2">
                                    <div className="flex items-center rounded-md outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary overflow-hidden">
                                        <input
                                            id="password"
                                            name="password"
                                            disabled={state.validationState.status === 'validating'}
                                            type={state.showPassword ? 'text' : 'password'}
                                            value={state.password}
                                            onChange={e =>
                                                dispatch({
                                                    type: 'SET_PASSWORD',
                                                    payload: e.target.value,
                                                })
                                            }
                                            placeholder="••••••••"
                                            className="block min-w-0 grow py-1.5 px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                dispatch({ type: 'TOGGLE_SHOW_PASSWORD' })
                                            }
                                            disabled={
                                                state.password.trim() === '' ||
                                                state.validationState.status === 'validating'
                                            }
                                            title={
                                                state.password.trim() === ''
                                                    ? ''
                                                    : state.showPassword
                                                      ? 'hide password'
                                                      : 'show password'
                                            }
                                            className={`ml-2 mr-3 ${state.password ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400`}
                                        >
                                            {state.showPassword ? (
                                                <EyeIcon className="w-5 h-5" />
                                            ) : (
                                                <EyeSlashIcon className="w-5 h-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex items-center gap-x-2">
                            <button
                                type="button"
                                title="reset"
                                disabled={
                                    state.validationState.status === 'validating' ||
                                    (state.password.trim() === '' &&
                                        originalCredentialsRef.current?.username === state.username)
                                }
                                className={`rounded-md py-2 px-2 shadow-xs text-white focus-visible:outline-2 focus-visible:outline-offset-2 flex items-center justify-center
                                    ${
                                        state.validationState.status === 'validating' ||
                                        (state.password.trim() === '' &&
                                            originalCredentialsRef.current?.username ===
                                                state.username)
                                            ? 'bg-gray-400'
                                            : 'bg-primary hover:bg-primary-light active:bg-primary-dark'
                                    }`}
                                style={{ height: '40px', width: '40px' }}
                                onClick={() =>
                                    dispatch({
                                        type: 'RESET_STATE',
                                        payload:
                                            originalCredentialsRef.current?.username ||
                                            initialUsername,
                                    })
                                }
                            >
                                <ArrowPathIcon className="w-5 h-5" />
                            </button>
                            <button
                                type="submit"
                                disabled={!isSubmitEnabled}
                                className={`rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 ${
                                    isSubmitEnabled
                                        ? 'bg-primary hover:bg-primary-light active:bg-primary-dark focus-visible:outline-primary'
                                        : 'bg-gray-400'
                                }`}
                            >
                                Validate &amp; Save
                            </button>
                            {(state.validationState.status === 'validating' ||
                                state.validationState.status === 'succeeded' ||
                                state.validationState.status === 'failed') &&
                                renderCredentialsValidationState(state.validationState)}
                        </div>

                        {state.validationState.status === 'invalid' &&
                            renderCredentialsValidationState(state.validationState)}
                    </div>
                </div>
            </form>
        </>
    );
};

export default SettingsPortalCredentials;
