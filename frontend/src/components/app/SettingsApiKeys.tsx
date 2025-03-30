import React, { useReducer, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, EyeIcon, EyeSlashIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { ClipboardIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Puff } from 'react-loader-spinner';
import { useZipCaseApi } from '../../hooks';
import { ApiKeyResponse } from '../../../../shared/types';
import { useMutation, useQueryClient, UseQueryResult } from '@tanstack/react-query';

type MessageType = 'error' | 'success';

type Message =
    | 'none'
    | {
          msg: string;
          type: MessageType;
      };

interface State {
    apiKey: string;
    showApiKey: boolean;
    apiKeyMessage: Message;
    webhook: string;
    webhookValid: boolean;
    webhookSecret: string;
    webhookMessage: Message;
}

const initialState = {
    apiKey: '',
    showApiKey: false,
    apiKeyMessage: 'none' as Message,
    webhook: '',
    webhookValid: false,
    webhookSecret: '',
    webhookMessage: 'none' as Message,
};

type Action =
    | { type: 'SET_API_KEY'; apiKey: string }
    | { type: 'TOGGLE_SHOW_API_KEY' }
    | { type: 'REQUEST_API_KEY' }
    | { type: 'SET_WEBHOOK'; webhook: string }
    | { type: 'SET_WEBHOOK_VALID'; valid: boolean }
    | { type: 'SET_WEBHOOK_SECRET'; secret: string }
    | { type: 'SET_API_KEY_MESSAGE'; message: Message }
    | { type: 'SET_WEBHOOK_MESSAGE'; message: Message };

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'SET_API_KEY':
            return { ...state, apiKey: action.apiKey };
        case 'TOGGLE_SHOW_API_KEY':
            return { ...state, showApiKey: !state.showApiKey };
        case 'SET_WEBHOOK':
            return { ...state, webhook: action.webhook };
        case 'SET_WEBHOOK_VALID':
            return { ...state, webhookValid: action.valid };
        case 'SET_WEBHOOK_SECRET':
            return { ...state, webhookSecret: action.secret };
        case 'SET_API_KEY_MESSAGE':
            return { ...state, apiKeyMessage: action.message };
        case 'SET_WEBHOOK_MESSAGE':
            return { ...state, webhookMessage: action.message };
        default:
            return state;
    }
}

// URL validation regex that requires protocol and domain
const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/;

interface SettingsApiKeysProps {
    apiSettings: UseQueryResult<ApiKeyResponse | null, Error>;
}

const SettingsApiKeys: React.FC<SettingsApiKeysProps> = ({ apiSettings: apiSettingsQuery }) => {
    const { data, isLoading, error, status } = apiSettingsQuery;
    const [state, dispatch] = useReducer(reducer, initialState);
    const webhookRef = useRef<HTMLInputElement>(null);
    const webhookTooltipRef = useRef<HTMLDivElement>(null);
    const [webhookTooltipVisible, setWebhookTooltipVisible] = useState(false);
    const secretTooltipRef = useRef<HTMLDivElement>(null);
    const [secretTooltipVisible, setSecretTooltipVisible] = useState(false);
    const queryClient = useQueryClient();

    // Update state when API key data is loaded from React Query
    useEffect(() => {
        if (!isLoading) {
            if (data) {
                if (data.apiKey) {
                    dispatch({ type: 'SET_API_KEY', apiKey: data.apiKey });
                }

                if (data.webhookUrl) {
                    dispatch({ type: 'SET_WEBHOOK', webhook: data.webhookUrl });
                    dispatch({ type: 'SET_WEBHOOK_VALID', valid: URL_REGEX.test(data.webhookUrl) });
                }

                if (data.sharedSecret) {
                    dispatch({ type: 'SET_WEBHOOK_SECRET', secret: data.sharedSecret });
                }
            } else if (status === 'error' && error) {
                console.error('Error loading API key:', error);
                dispatch({
                    type: 'SET_API_KEY_MESSAGE',
                    message: { msg: 'API key could not be loaded', type: 'error' },
                });
            }
        }
    }, [data, isLoading, error, status]);

    // Close tooltips when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                webhookTooltipRef.current &&
                !webhookTooltipRef.current.contains(event.target as Node)
            ) {
                if (webhookTooltipVisible) {
                    setWebhookTooltipVisible(false);
                }
            }

            if (
                secretTooltipRef.current &&
                !secretTooltipRef.current.contains(event.target as Node)
            ) {
                if (secretTooltipVisible) {
                    setSecretTooltipVisible(false);
                }
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [webhookTooltipVisible, secretTooltipVisible]);

    // API calls using React Query mutations
    const createApiKey = useZipCaseApi(client => client.apiKeys.create()).callApi;
    const saveWebhook = useZipCaseApi(client =>
        client.webhooks.set({
            webhookUrl: state.webhook,
            sharedSecret: state.webhookSecret,
        })
    ).callApi;

    // Create API key mutation
    const createApiKeyMutation = useMutation({
        mutationFn: async () => {
            return await createApiKey();
        },
        onMutate: () => {
            dispatch({
                type: 'SET_API_KEY_MESSAGE',
                message: { msg: 'Requesting API key...', type: 'success' },
            });
        },
        onSuccess: response => {
            if (response.success && response.data) {
                dispatch({ type: 'SET_API_KEY', apiKey: response.data.apiKey });
                dispatch({
                    type: 'SET_API_KEY_MESSAGE',
                    message: { msg: 'API key issued successfully', type: 'success' },
                });

                // Update cache
                queryClient.setQueryData(['apiSettings'], {
                    ...data,
                    apiKey: response.data.apiKey,
                });

                setTimeout(() => {
                    dispatch({ type: 'SET_API_KEY_MESSAGE', message: 'none' });
                }, 5000);
            } else {
                throw new Error(response.error || 'API did not return a valid API key');
            }
        },
        onError: (error: Error) => {
            console.error('Error issuing API key:', error);
            dispatch({
                type: 'SET_API_KEY_MESSAGE',
                message: { msg: 'Failed to issue API key', type: 'error' },
            });
        },
    });

    // Save webhook mutation
    const saveWebhookMutation = useMutation({
        mutationFn: async () => {
            return await saveWebhook();
        },
        onMutate: () => {
            dispatch({
                type: 'SET_WEBHOOK_MESSAGE',
                message: { msg: 'Saving webhook settings...', type: 'success' },
            });
        },
        onSuccess: response => {
            if (response.success) {
                dispatch({
                    type: 'SET_WEBHOOK_MESSAGE',
                    message: { msg: 'Webhook settings saved successfully', type: 'success' },
                });

                // Update cache
                queryClient.setQueryData(['apiSettings'], {
                    ...data,
                    webhookUrl: state.webhook.trim(),
                    sharedSecret: state.webhookSecret.trim(),
                });

                setTimeout(() => {
                    dispatch({ type: 'SET_WEBHOOK_MESSAGE', message: 'none' });
                }, 5000);
            } else {
                throw new Error(response.error || 'Failed to save webhook settings');
            }
        },
        onError: (error: Error) => {
            console.error('Error saving webhook settings:', error);
            dispatch({
                type: 'SET_WEBHOOK_MESSAGE',
                message: { msg: 'Failed to save webhook settings', type: 'error' },
            });
        },
    });

    const requestApiKey = () => {
        createApiKeyMutation.mutate();
    };

    const copyApiKey = async () => {
        if (navigator.clipboard) {
            if (state.showApiKey) {
                dispatch({ type: 'TOGGLE_SHOW_API_KEY' });
            }
            navigator.clipboard
                .writeText(state.apiKey)
                .then(() => {
                    dispatch({
                        type: 'SET_API_KEY_MESSAGE',
                        message: { msg: 'API key copied to clipboard', type: 'success' },
                    });
                    setTimeout(() => {
                        dispatch({ type: 'SET_API_KEY_MESSAGE', message: 'none' });
                    }, 5000);
                })
                .catch(() => {
                    dispatch({
                        type: 'SET_API_KEY_MESSAGE',
                        message: { msg: 'Failed to copy API key to clipboard', type: 'error' },
                    });
                });
        } else {
            dispatch({
                type: 'SET_API_KEY_MESSAGE',
                message: { msg: 'API key cannot be copied to clipboard', type: 'error' },
            });
        }
    };

    const handleWebhookChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const webhookUrl = e.target.value.trim();
        dispatch({ type: 'SET_WEBHOOK', webhook: webhookUrl });

        // Validate the trimmed webhook URL
        const isValid = URL_REGEX.test(webhookUrl.trim());
        dispatch({ type: 'SET_WEBHOOK_VALID', valid: isValid });

        // Clear any webhook error message when the user changes the input
        if (state.webhookMessage !== 'none') {
            dispatch({ type: 'SET_WEBHOOK_MESSAGE', message: 'none' });
        }
    };

    const saveWebhookHandler = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!state.webhookValid) return;

        dispatch({ type: 'SET_WEBHOOK', webhook: state.webhook.trim() });
        dispatch({ type: 'SET_WEBHOOK_SECRET', secret: state.webhookSecret.trim() });

        saveWebhookMutation.mutate();
    };

    if (isLoading) {
        return (
            <div className="space-y-6 mt-6 border-b border-gray-200 pb-12">
                <h2 className="text-base/7 font-semibold text-gray-900">API</h2>
                <div className="ml-6 flex items-center">
                    <div className="w-8 h-8">
                        <Puff height="100%" width="100%" color="#4fa94d" ariaLabel="puff-loading" />
                    </div>
                    <span className="ml-2">Loading API settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 mt-6 border-b border-gray-200 pb-12">
            <h2 className="text-base/7 font-semibold text-gray-900">API</h2>
            <div className="ml-6">
                <div className="mb-6">
                    <div className="flex items-center mb-2">
                        <label
                            htmlFor="apiKey"
                            className="block text-sm/6 font-medium text-gray-700"
                        >
                            API Key
                        </label>
                    </div>
                    {state.apiKey ? (
                        <div className="flex items-center rounded-md bg-white pl-3 outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary max-w-[520px]">
                            <input
                                id="apiKey"
                                name="apiKey"
                                type={state.showApiKey ? 'text' : 'password'}
                                disabled={true}
                                value={
                                    state.showApiKey
                                        ? state.apiKey
                                        : '••••••••••••••••••••••••••••••••••••••••••'
                                }
                                className="block min-w-0 grow py-1.5 pr-3 pl-1 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                            />
                            <button
                                type="button"
                                onClick={copyApiKey}
                                title="copy API key to clipboard"
                                className={`ml-2 mr-2 ${state.apiKey ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400`}
                            >
                                <ClipboardIcon className="w-5 h-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => dispatch({ type: 'TOGGLE_SHOW_API_KEY' })}
                                title="show API key"
                                className={`ml-2 mr-2 ${state.apiKey ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400`}
                            >
                                {state.showApiKey ? (
                                    <EyeIcon className="w-5 h-5" />
                                ) : (
                                    <EyeSlashIcon className="w-5 h-5" />
                                )}
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={requestApiKey}
                            className="rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 bg-primary hover:bg-primary-light active:bg-primary-dark focus-visible:outline-primary"
                        >
                            Request API Key
                        </button>
                    )}

                    {state.apiKeyMessage !== 'none' && (
                        <div className="flex items-center mt-2">
                            {state.apiKeyMessage.type === 'error' ? (
                                <XCircleIcon className="w-5 h-5 text-red-700" />
                            ) : (
                                <CheckCircleIcon className="w-5 h-5 text-green-700" />
                            )}
                            <p
                                className={`ml-2 ${state.apiKeyMessage.type === 'error' ? 'text-red' : 'text-green'}-700`}
                            >
                                {state.apiKeyMessage.msg}
                            </p>
                        </div>
                    )}
                </div>

                <div className="mt-6">
                    <form onSubmit={saveWebhookHandler}>
                        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-6">
                            <div className="sm:col-span-3 xl:col-span-2">
                                <div className="flex items-center relative">
                                    <label
                                        htmlFor="webhook"
                                        className="block text-sm/6 font-medium text-gray-700"
                                    >
                                        Webhook
                                    </label>
                                    <div className="relative ml-2 flex items-center">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setWebhookTooltipVisible(!webhookTooltipVisible)
                                            }
                                            className="text-gray-500 hover:text-gray-700 flex items-center"
                                            aria-label="Webhook information"
                                        >
                                            <InformationCircleIcon className="h-5 w-5" />
                                        </button>
                                        {webhookTooltipVisible && (
                                            <div
                                                ref={webhookTooltipRef}
                                                className="absolute z-30 w-80 p-2 mt-2 text-sm text-left text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg -left-28 top-6"
                                            >
                                                This web address will be called with data for each
                                                case requested through the API.
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-2">
                                    <div className="relative flex-1">
                                        {!state.apiKey && (
                                            <div className="absolute inset-0 bg-gray-200 opacity-50 rounded-md z-20"></div>
                                        )}
                                        <div className="flex items-center rounded-md bg-white pl-3 outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary">
                                            <input
                                                id="webhook"
                                                name="webhook"
                                                type="text"
                                                ref={webhookRef}
                                                value={state.webhook}
                                                onChange={handleWebhookChange}
                                                placeholder="https://your-domain.com/handle-case-update"
                                                disabled={!state.apiKey}
                                                className="block min-w-0 grow py-1.5 pr-3 pl-1 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="sm:col-span-3 xl:col-span-2">
                                <div className="flex items-center relative">
                                    <label
                                        htmlFor="webhookSecret"
                                        className="block text-sm/6 font-medium text-gray-700"
                                    >
                                        Shared secret
                                    </label>
                                    <div className="relative ml-2 flex items-center">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSecretTooltipVisible(!secretTooltipVisible)
                                            }
                                            className="text-gray-500 hover:text-gray-700 flex items-center"
                                            aria-label="Webhook Secret information"
                                        >
                                            <InformationCircleIcon className="h-5 w-5" />
                                        </button>
                                        {secretTooltipVisible && (
                                            <div
                                                ref={secretTooltipRef}
                                                className="absolute z-30 w-80 p-2 mt-2 text-sm text-left text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg -left-28 top-6"
                                            >
                                                This secret will be sent with each call to your
                                                webhook. Use this to verify that calls are coming
                                                from ZipCase.
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-2">
                                    <div className="relative flex-1">
                                        {(!state.apiKey || !state.webhookValid) && (
                                            <div className="absolute inset-0 bg-gray-200 opacity-50 rounded-md z-20"></div>
                                        )}
                                        <div className="flex items-center rounded-md bg-white pl-3 outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary">
                                            <input
                                                id="webhookSecret"
                                                name="webhookSecret"
                                                type="text"
                                                value={state.webhookSecret}
                                                onChange={e =>
                                                    dispatch({
                                                        type: 'SET_WEBHOOK_SECRET',
                                                        secret: e.target.value,
                                                    })
                                                }
                                                placeholder="01234567-89ab-cdef-0123-456789abcdef"
                                                disabled={!state.apiKey || !state.webhookValid}
                                                maxLength={128}
                                                className="block min-w-0 grow py-1.5 pr-3 pl-1 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="sm:col-span-6 flex mt-4">
                                <button
                                    type="submit"
                                    disabled={
                                        !state.webhookValid ||
                                        !state.apiKey ||
                                        saveWebhookMutation.isPending
                                    }
                                    title={
                                        !state.apiKey
                                            ? 'Request an API key first'
                                            : state.webhook && !state.webhookValid
                                              ? 'Webhook URL is invalid'
                                              : ''
                                    }
                                    className={`rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 ${
                                        state.webhookValid &&
                                        state.apiKey &&
                                        !saveWebhookMutation.isPending
                                            ? 'bg-primary hover:bg-primary-light active:bg-primary-dark focus-visible:outline-primary'
                                            : 'bg-gray-400'
                                    }`}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </form>

                    {state.webhookMessage !== 'none' && (
                        <div className="flex items-center mt-2">
                            {state.webhookMessage.type === 'error' ? (
                                <XCircleIcon className="w-5 h-5 text-red-700" />
                            ) : (
                                <CheckCircleIcon className="w-5 h-5 text-green-700" />
                            )}
                            <p
                                className={`ml-2 ${state.webhookMessage.type === 'error' ? 'text-red' : 'text-green'}-700`}
                            >
                                {state.webhookMessage.msg}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsApiKeys;
