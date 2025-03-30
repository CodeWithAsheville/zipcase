import { fetchAuthSession } from '@aws-amplify/core';
import { API_URL } from '../aws-exports';
import {
    ApiKeyResponse,
    PortalCredentialsRequest,
    PortalCredentialsResponse,
    SearchResponse,
    SearchResult,
    WebhookSettings,
} from '../../../shared/types';

export interface ZipCaseResponse<T> {
    success: boolean;
    status: number;
    data: T | null;
    error: string | null;
}

export class ZipCaseClient {
    private baseUrl: string;

    constructor(baseUrl: string = API_URL) {
        this.baseUrl = baseUrl.endsWith('/')
            ? baseUrl.slice(0, -1) // Remove trailing slash
            : baseUrl;
    }

    credentials = {
        get: async (): Promise<ZipCaseResponse<PortalCredentialsResponse>> => {
            return this.request<PortalCredentialsResponse>('/portal-credentials', {
                method: 'GET',
            });
        },

        set: async (
            credentials: PortalCredentialsRequest
        ): Promise<ZipCaseResponse<PortalCredentialsResponse>> => {
            return this.request<PortalCredentialsResponse>('/portal-credentials', {
                method: 'POST',
                data: credentials,
            });
        },
    };

    apiKeys = {
        get: async (): Promise<ZipCaseResponse<ApiKeyResponse>> => {
            return this.request<ApiKeyResponse>('/api-key', { method: 'GET' });
        },

        create: async (): Promise<ZipCaseResponse<ApiKeyResponse>> => {
            return this.request<ApiKeyResponse>('/api-key', {
                method: 'POST',
                data: {},
            });
        },
    };

    webhooks = {
        set: async (
            webhookSettings: WebhookSettings
        ): Promise<ZipCaseResponse<WebhookSettings>> => {
            return this.request<WebhookSettings>('/webhook', {
                method: 'POST',
                data: webhookSettings,
            });
        },
    };

    /**
     * Case search and retrieval endpoints
     */
    cases = {
        search: async (searchInput: string): Promise<ZipCaseResponse<SearchResponse>> => {
            return await this.request<SearchResponse>('/search', {
                method: 'POST',
                data: { search: searchInput },
            });
        },

        status: async (caseNumbers: string[]): Promise<ZipCaseResponse<SearchResponse>> => {
            return await this.request<SearchResponse>('/status', {
                method: 'POST',
                data: { caseNumbers },
            });
        },

        get: async (caseNumber: string): Promise<ZipCaseResponse<SearchResult>> => {
            return await this.request<SearchResult>(`/case/${caseNumber}`, { method: 'GET' });
        },
    };

    /**
     * Core request method that handles all API interactions
     */
    private async request<T>(
        endpoint: string,
        options: { method?: string; data?: any } = {}
    ): Promise<ZipCaseResponse<T>> {
        const { method = 'GET', data } = options;

        // Make sure endpoint doesn't start with a slash when combined with baseUrl
        const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const url = `${this.baseUrl}/${path}`;

        try {
            // Get authentication token from Amplify
            const session = await fetchAuthSession();
            const token = session.tokens?.accessToken;

            if (!token) {
                return {
                    success: false,
                    status: 401,
                    data: null,
                    error: 'No authentication token available',
                };
            }

            // Prepare request options
            const requestOptions: RequestInit = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token.toString()}`,
                },
            };

            // Add request body for non-GET requests
            if (method !== 'GET' && data) {
                requestOptions.body = JSON.stringify(data);
            }

            // Execute the API request
            const response = await fetch(url, requestOptions);
            const status = response.status;

            // Parse the response body (even for error responses)
            let responseBody;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                responseBody = await response.json();
            } else {
                responseBody = await response.text();
            }

            // Handle successful response
            if (response.ok) {
                return {
                    success: true,
                    status,
                    data: responseBody as T,
                    error: null,
                };
            }

            // Handle error response
            return {
                success: false,
                status,
                data: null,
                error:
                    typeof responseBody === 'object' && responseBody.error
                        ? responseBody.error
                        : `Request failed with status ${status}`,
            };
        } catch (error) {
            // Handle network or other errors
            return {
                success: false,
                status: 0, // No HTTP status for network errors
                data: null,
                error: (error as Error).message || 'Network error occurred',
            };
        }
    }
}
