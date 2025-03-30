/**
 * WS-Federation Authentication Flow
 *
 * This module implements the WS-Federation authentication flow for the court portal.
 *
 * Cookie Handling Strategy:
 * 1. We use tough-cookie's CookieJar with axios-cookiejar-support for automatic cookie management
 * 2. We verify authentication success by looking for both session cookies (FedAuth tokens)
 *    and the "Welcome, " text in the response HTML.
 */
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import StorageClient from './StorageClient';

const DEFAULT_TIMEOUT = 20000;

// Configure axios-cookiejar-support with better defaults
const axiosWithCookies = wrapper(axios);

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const defaultRequestHeaders = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

export interface PortalAuthResult {
    success: boolean;
    cookieJar?: CookieJar;
    message?: string;
}

export interface PortalAuthOptions {
    timeout?: number;
    debug?: boolean;
}

function extractVerificationToken(html: string): string | null {
    try {
        const $ = cheerio.load(html);
        return ($('input[name="__RequestVerificationToken"]').val() as string) || null;
    } catch (error) {
        return null;
    }
}

function extractLoginUrl(response: AxiosResponse): string | null {
    // First try to get it from Location header if it was a redirect
    if (response.request?.res?.responseUrl) {
        return response.request.res.responseUrl;
    }

    // Then check the HTML for a form action
    try {
        const $ = cheerio.load(response.data);
        const formAction = $('form').attr('action');
        if (formAction) return formAction;
    } catch (error) {
        // Ignore parsing errors
    }

    return null;
}

function extractWsFedToken(html: string): string | null {
    try {
        const $ = cheerio.load(html);
        return ($('input[name="wresult"]').val() as string) || null;
    } catch (error) {
        return null;
    }
}

const PortalAuthenticator = {
    async authenticateWithPortal(
        username: string,
        password: string,
        options: PortalAuthOptions = {}
    ): Promise<PortalAuthResult> {
        const portalBaseUrl = process.env.PORTAL_URL;

        if (!portalBaseUrl) {
            console.error('Error: PORTAL_URL environment variable is not set');
            return {
                success: false,
                message: 'PORTAL_URL environment variable is not set',
            };
        }

        const timeout = options.timeout || DEFAULT_TIMEOUT;
        const debug = options.debug || false;

        const jar = new CookieJar();

        const client = axiosWithCookies.create({
            timeout,
            maxRedirects: 10,
            validateStatus: status => status < 500, // Only reject on 5xx errors
            jar,
            withCredentials: true, // Enables sending cookies with cross-domain requests
            headers: defaultRequestHeaders,
        });

        try {
            // Step 1: Begin WS-Federation Flow - Access the login page
            if (debug) console.log('Step 1: Beginning WS-Federation flow');

            const loginPageResponse = await client.get(portalBaseUrl + '/Portal/Account/Login');

            if (debug) {
                console.log('Cookie jar after login page response:', jar.toJSON());
            }

            // Extract the verification token for CSRF protection
            const verificationToken = extractVerificationToken(loginPageResponse.data);
            if (!verificationToken) {
                return {
                    success: false,
                    message: 'Failed to extract verification token from login page',
                };
            }

            if (debug) console.log(`Verification token: ${verificationToken}`);

            // Extract the login URL if we were redirected
            const loginUrl = extractLoginUrl(loginPageResponse);
            if (!loginUrl) {
                return {
                    success: false,
                    message: 'Failed to extract login URL from response',
                };
            }

            if (debug) console.log(`Login URL: ${loginUrl}`);

            // Step 2: Submit Login Form - Send credentials
            if (debug) console.log('Step 2: Submitting login form');

            const loginFormData = new URLSearchParams();
            loginFormData.append('__RequestVerificationToken', verificationToken);
            loginFormData.append('UserName', username);
            loginFormData.append('Password', password);

            if (debug) {
                console.log('Login form data:');
                console.log('- RequestVerificationToken:', verificationToken);
                console.log('- UserName:', username);
                console.log('- Password:', '*'.repeat(12));
            }

            const loginSubmitResponse = await client.post(loginUrl, loginFormData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Origin: new URL(loginUrl).origin,
                    Referer: loginUrl,
                    'User-Agent': USER_AGENT,
                },
            });

            if (debug)
                console.log(`Login form submission response code: ${loginSubmitResponse.status}`);

            if (debug) {
                console.log('Cookie jar after login submission:', jar.toJSON());
            }

            // Check for login failure
            if (loginSubmitResponse.data.includes('Invalid Email or password.')) {
                if (debug) {
                    console.log('Login form response indicates auth failure:');
                    console.log('Status code:', loginSubmitResponse.status);
                    console.log(
                        'Response URL:',
                        loginSubmitResponse.request?.res?.responseUrl || 'No URL'
                    );

                    // Log a snippet of the content
                    const contentSnippet = loginSubmitResponse.data.substring(0, 1000) + '...';
                    console.log('Response content snippet:', contentSnippet);
                }

                return {
                    success: false,
                    message: 'Invalid Email or password',
                };
            }

            if (debug) console.log(loginSubmitResponse.data);

            // Extract the WS-Federation token from the response
            const wsFedToken = extractWsFedToken(loginSubmitResponse.data);
            if (!wsFedToken) {
                return {
                    success: false,
                    message: 'Failed to extract WS-Federation token after login',
                };
            }

            // Step 3: Complete WS-Federation Flow - Submit the token back to the portal
            if (debug) console.log('Step 3: Completing WS-Federation flow');

            const completeWsFedData = new URLSearchParams();
            completeWsFedData.append('wa', 'wsignin1.0');
            completeWsFedData.append('wresult', wsFedToken);
            completeWsFedData.append('wctx', 'rm=0&id=passive&ru=%2fPortal%2fAccount%2fLogin');

            if (debug) {
                console.log('Submitting WS-Federation token to Portal endpoint with data:');
                console.log('wa:', completeWsFedData.get('wa'));
                console.log('wctx:', completeWsFedData.get('wctx'));
                console.log('wresult (length):', completeWsFedData.get('wresult')?.length || 0);
            }

            const completeWsFedResponse = await client.post(
                portalBaseUrl + '/Portal',
                completeWsFedData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Origin: portalBaseUrl,
                        Referer: loginSubmitResponse.request?.res?.responseUrl || loginUrl,
                        'User-Agent': USER_AGENT,
                    },
                    maxRedirects: 10,
                }
            );

            if (debug) {
                console.log('Cookie jar after WS-Federation completion:', jar.toJSON());
                console.log(
                    'Response URL after redirects:',
                    completeWsFedResponse.request?.res?.responseUrl || 'No redirect URL'
                );
                console.log('Response status code:', completeWsFedResponse.status);
                console.log('Response headers:', completeWsFedResponse.headers);
            }

            // Check for successful login by looking for session cookies or logged-in indicators
            const cookies = jar.getCookiesSync(portalBaseUrl, {
                allPaths: true,
            });

            if (debug) {
                console.log('Number of cookies:', cookies.length);
                cookies.forEach(cookie => {
                    console.log(
                        `Cookie: ${cookie.key}=${cookie.value.substring(0, 15)}... Domain: ${cookie.domain}, Path: ${cookie.path}, HttpOnly: ${cookie.httpOnly}, Secure: ${cookie.secure}`
                    );
                });
            }

            const hasSessionCookie =
                cookies.some(cookie => cookie.key === 'FedAuth') &&
                cookies.some(cookie => cookie.key === 'FedAuth1');

            // Check for both "Sign In" button (failure) and "Welcome, " text (success)
            const hasWelcomeUser = completeWsFedResponse.data.includes('Welcome, ');
            const hasSignIn = completeWsFedResponse.data.includes('Sign In');

            if (debug) {
                console.log('Page contains "Welcome, ":', hasWelcomeUser);
                console.log('Page contains "Sign In":', hasSignIn);
            }

            if (!hasSessionCookie || (!hasWelcomeUser && hasSignIn)) {
                console.log(
                    `Authentication failed! Has "Welcome": ${hasWelcomeUser}; has "Sign In": ${hasSignIn}; dumping full cookie jar:`
                );
                console.log(JSON.stringify(jar.toJSON(), null, 2));
                return {
                    success: false,
                    message: 'Failed to establish valid session after authentication',
                };
            }

            // Success! Return the cookie jar for session management
            return {
                success: true,
                cookieJar: jar,
            };
        } catch (error) {
            return {
                success: false,
                message: `Authentication error: ${(error as Error).message}`,
            };
        }
    },

    async verifySession(cookieJar: CookieJar, options: PortalAuthOptions = {}): Promise<boolean> {
        const portalBaseUrl = process.env.PORTAL_URL;

        if (!portalBaseUrl) {
            console.error('Error: PORTAL_URL environment variable is not set');
            return false;
        }

        const timeout = options.timeout || DEFAULT_TIMEOUT;
        const debug = options.debug || false;

        try {
            // Check for FedAuth cookies which are critical for authentication
            const cookies = cookieJar.getCookiesSync(portalBaseUrl, { allPaths: true });

            if (debug) {
                console.log('Number of cookies before verification:', cookies.length);
                cookies.forEach(cookie => {
                    console.log(
                        `Cookie: ${cookie.key}=${cookie.value.substring(0, 15)}... Domain: ${cookie.domain}, Path: ${cookie.path}, HttpOnly: ${cookie.httpOnly}, Secure: ${cookie.secure}`
                    );
                });

                const fedAuthCookie = cookies.find(cookie => cookie.key === 'FedAuth');
                const fedAuth1Cookie = cookies.find(cookie => cookie.key === 'FedAuth1');
                console.log('FedAuth cookie exists:', !!fedAuthCookie);
                console.log('FedAuth1 cookie exists:', !!fedAuth1Cookie);
            }

            // Create axios instance with cookie jar support
            const client = axiosWithCookies.create({
                timeout,
                maxRedirects: 10,
                validateStatus: status => status < 500,
                jar: cookieJar,
                withCredentials: true,
                headers: defaultRequestHeaders,
            });

            // Build a manual cookie string to ensure all cookies are properly sent
            let cookieHeader = '';
            cookies.forEach(cookie => {
                if (cookieHeader) cookieHeader += '; ';
                cookieHeader += `${cookie.key}=${cookie.value}`;
            });

            if (debug) {
                console.log('Manual cookie header:', cookieHeader);
            }

            const response = await client.get(portalBaseUrl + '/Portal', {
                headers: {
                    Cookie: cookieHeader,
                    'User-Agent': USER_AGENT,
                },
            });

            if (debug) {
                console.log('Response status:', response.status);
                console.log(
                    'Response URL (after redirects):',
                    response.request?.res?.responseUrl || 'No redirect URL'
                );

                // Check for login indicators
                const hasSignIn = response.data.includes('Sign In');
                const hasWelcomeUser = response.data.includes('Welcome, ');

                console.log('Page contains "Sign In":', hasSignIn);
                console.log('Page contains "Welcome, ":', hasWelcomeUser);

                // If the response is too large, just log a snippet
                if (response.data.length > 500) {
                    console.log(
                        'Response data (first 500 chars):',
                        response.data.substring(0, 500) + '...'
                    );
                }
            }

            // Session is valid if the welcome message is present or no sign in button
            return response.data.includes('Welcome, ') || !response.data.includes('Sign In');
        } catch (error) {
            if (debug) {
                console.error('Error verifying session:', error);
            }
            return false;
        }
    },

    async getOrCreateUserSession(userId: string): Promise<PortalAuthResult> {
        const sessionCookieJar = await StorageClient.getUserSession(userId);

        if (sessionCookieJar) {
            return {
                success: true,
                cookieJar: CookieJar.fromJSON(sessionCookieJar),
            };
        }

        const portalCredentials = await StorageClient.sensitiveGetPortalCredentials(userId);

        if (!portalCredentials) {
            return {
                success: false,
                message: 'No portal credentials found for user',
            };
        } else if (portalCredentials.isBad) {
            return {
                success: false,
                message: 'Portal credentials for user are invalid',
            };
        }

        return await this.authenticateWithPortal(
            portalCredentials.username,
            portalCredentials.password
        );
    },
};

export default PortalAuthenticator;
