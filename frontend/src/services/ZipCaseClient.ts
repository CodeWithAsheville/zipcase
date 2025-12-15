import { fetchAuthSession } from '@aws-amplify/core';
import { format } from 'date-fns';
import { API_URL } from '../aws-exports';
import {
    ApiKeyResponse,
    NameSearchResponse,
    PortalCredentialsRequest,
    PortalCredentialsResponse,
    CaseSearchResponse,
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
        if (!baseUrl) {
            throw new Error('API_URL is required');
        }

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

        set: async (credentials: PortalCredentialsRequest): Promise<ZipCaseResponse<PortalCredentialsResponse>> => {
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
        set: async (webhookSettings: WebhookSettings): Promise<ZipCaseResponse<WebhookSettings>> => {
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
        search: async (searchInput: string): Promise<ZipCaseResponse<CaseSearchResponse>> => {
            return await this.request<CaseSearchResponse>('/search', {
                method: 'POST',
                data: { search: searchInput },
            });
        },

        nameSearch: async (
            name: string,
            dateOfBirth?: string,
            soundsLike = false,
            criminalOnly = true
        ): Promise<ZipCaseResponse<NameSearchResponse>> => {
            return await this.request<NameSearchResponse>('/name-search', {
                method: 'POST',
                data: {
                    name,
                    dateOfBirth,
                    soundsLike,
                    criminalOnly,
                },
            });
        },

        nameSearchStatus: async (searchId: string): Promise<ZipCaseResponse<NameSearchResponse>> => {
            return await this.request<NameSearchResponse>(`/name-search/${searchId}`, {
                method: 'GET',
            });
        },

        status: async (caseNumbers: string[]): Promise<ZipCaseResponse<CaseSearchResponse>> => {
            return await this.request<CaseSearchResponse>('/status', {
                method: 'POST',
                data: { caseNumbers },
            });
        },

        get: async (caseNumber: string): Promise<ZipCaseResponse<SearchResult>> => {
            return await this.request<SearchResult>(`/case/${caseNumber}`, { method: 'GET' });
        },

        export: async (caseNumbers: string[]): Promise<void> => {
            return await this.download('/export', {
                method: 'POST',
                data: { caseNumbers },
            });
        },
    };

    /**
     * Helper method to handle file downloads
     */
    private async download(endpoint: string, options: { method?: string; data?: unknown } = {}): Promise<void> {
        const { method = 'GET', data } = options;
        const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const url = `${this.baseUrl}/${path}`;

        try {
            const session = await fetchAuthSession();
            const token = session.tokens?.accessToken;

            if (!token) {
                throw new Error('No authentication token available');
            }

            const requestOptions: RequestInit = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token.toString()}`,
                },
            };

            if (method !== 'GET' && data) {
                requestOptions.body = JSON.stringify(data);
            }

            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                throw new Error(`Download failed with status ${response.status}`);
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;

            const contentDisposition = response.headers.get('Content-Disposition');

            // Generate a default filename with local timestamp
            const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
            let filename = `ZipCase-Export-${timestamp}.xlsx`;

            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch && filenameMatch.length === 2) {
                    filename = filenameMatch[1];
                }
            }

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download error:', error);
            throw error;
        }
    }

    /**
     * Core request method that handles all API interactions
     */
    private async request<T>(endpoint: string, options: { method?: string; data?: unknown } = {}): Promise<ZipCaseResponse<T>> {
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
                error: typeof responseBody === 'object' && responseBody.error ? responseBody.error : `Request failed with status ${status}`,
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
