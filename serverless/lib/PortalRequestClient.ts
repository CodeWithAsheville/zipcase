import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import AwsWafChallengeSolver from './AwsWafChallengeSolver';
import PortalAuthenticator from './PortalAuthenticator';

const DEFAULT_TIMEOUT = 20000;

export interface PortalRequestClientOptions {
    jar: CookieJar;
    portalUrl: string;
    userAgent: string;
    timeout?: number;
    maxRetries?: number;
    defaultHeaders?: Record<string, string>;
}

export interface PortalRequestConfig extends AxiosRequestConfig {
    wafContextUrl?: string;
    skipWafHandling?: boolean;
}

export default class PortalRequestClient {
    private readonly client: AxiosInstance;
    private readonly jar: CookieJar;
    private readonly portalUrl: string;
    private readonly maxRetries: number;

    constructor(options: PortalRequestClientOptions) {
        this.jar = options.jar;
        this.portalUrl = options.portalUrl;
        this.maxRetries = options.maxRetries ?? 2;

        this.client = wrapper(axios).create({
            timeout: options.timeout ?? DEFAULT_TIMEOUT,
            maxRedirects: 10,
            validateStatus: status => status < 500,
            jar: options.jar,
            withCredentials: true,
            headers: {
                ...PortalAuthenticator.getDefaultRequestHeaders(options.userAgent),
                ...(options.defaultHeaders || {}),
            },
        });
    }

    async request<T = string>(config: PortalRequestConfig): Promise<AxiosResponse<T>> {
        const attemptRequest = async (attempt: number): Promise<AxiosResponse<T>> => {
            const method = String(config.method || 'GET').toLowerCase();
            const response = await this.executeRequest<T>(method, config);

            if (config.skipWafHandling || !AwsWafChallengeSolver.detectChallenge(response as AxiosResponse)) {
                return response;
            }

            if (attempt >= this.maxRetries) {
                return response;
            }

            const wafContextUrl =
                config.wafContextUrl ||
                response.request?.res?.responseUrl ||
                (typeof config.url === 'string' ? config.url : this.portalUrl);

            const wafResult = await AwsWafChallengeSolver.solveChallenge(wafContextUrl, String(response.data || ''));
            if (!wafResult.success || !wafResult.cookie) {
                return response;
            }

            PortalAuthenticator.addWafCookieToJar(this.jar, wafResult.cookie, [this.portalUrl, wafContextUrl]);
            return attemptRequest(attempt + 1);
        };

        return attemptRequest(0);
    }

    private async executeRequest<T>(method: string, config: PortalRequestConfig): Promise<AxiosResponse<T>> {
        if (typeof this.client.request === 'function') {
            return this.client.request<T>(config);
        }

        if (method === 'post' && typeof this.client.post === 'function') {
            return this.client.post<T>(String(config.url), config.data, config);
        }

        if (method === 'get' && typeof this.client.get === 'function') {
            return this.client.get<T>(String(config.url), config);
        }

        throw new Error(`Unsupported axios client method: ${method}`);
    }

    async get<T = string>(url: string, config: PortalRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.request<T>({
            ...config,
            method: 'GET',
            url,
        });
    }

    async post<T = string>(url: string, data?: unknown, config: PortalRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.request<T>({
            ...config,
            method: 'POST',
            url,
            data,
        });
    }
}
