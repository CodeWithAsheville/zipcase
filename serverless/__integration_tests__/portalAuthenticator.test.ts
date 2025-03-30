/**
 * Integration tests for Portal Authentication
 *
 * These tests require real credentials and should only be run
 * in a development environment
 *
 * Run with:
 * USERNAME=your_username PASSWORD=your_password npm run test:integration
 */
import PortalAuthenticator from '../lib/PortalAuthenticator';
import { CookieJar } from 'tough-cookie';

// Check for required environment variables
const username = process.env.USERNAME;
const password = process.env.PASSWORD;

// Set the portal URL environment variable (required by PortalAuthenticator)
process.env.PORTAL_URL = 'https://portal.example.com';

// Skip all tests if credentials are not provided
const runTests = !!username && !!password;

// Shared variables
let cookieJar: CookieJar | undefined;

describe('Portal Authentication Integration', () => {
    beforeAll(() => {
        if (!runTests) {
            console.warn(
                'Skipping Portal auth tests. ' +
                    'Set USERNAME and PASSWORD environment variables to run these tests.'
            );
        }
    });

    it('should authenticate with valid credentials', async () => {
        if (!runTests) {
            return;
        }

        const result = await PortalAuthenticator.authenticateWithPortal(username!, password!, {
            debug: true,
        });

        // If authentication fails, log detailed error information before failing the test
        if (!result.success) {
            console.error('Authentication failed with the following details:');
            console.error(`Error message: ${result.message}`);
        }

        expect(result.success).toBe(true);
        expect(result.cookieJar).toBeDefined();

        // Save the cookie jar for the next test
        cookieJar = result.cookieJar;

        // Log cookies for debugging
        console.log('Authentication successful');
        if (result.cookieJar) {
            const cookies = result.cookieJar.getCookiesSync('https://portal.example.com', {
                allPaths: true,
            });
            console.log(`Number of cookies: ${cookies.length}`);

            // Log each cookie with details for debugging
            cookies.forEach(cookie => {
                console.log(
                    `Cookie: ${cookie.key}=${cookie.value.substring(0, 15)}... Domain: ${cookie.domain}, Path: ${cookie.path}, HttpOnly: ${cookie.httpOnly}, Secure: ${cookie.secure}`
                );
            });

            // Check for the critical FedAuth cookies
            const hasFedAuth = cookies.some(cookie => cookie.key === 'FedAuth');
            const hasFedAuth1 = cookies.some(cookie => cookie.key === 'FedAuth1');
            console.log('Has FedAuth cookie:', hasFedAuth);
            console.log('Has FedAuth1 cookie:', hasFedAuth1);
        }
    });

    it('should verify a valid session', async () => {
        if (!runTests || !cookieJar) {
            return;
        }

        console.log('Verifying session with cookie jar...');

        // Log the cookies again before verification
        const cookies = cookieJar.getCookiesSync('https://portal.example.com', {
            allPaths: true,
        });
        console.log(`Number of cookies before verification: ${cookies.length}`);

        // Log each cookie with details for debugging
        cookies.forEach(cookie => {
            console.log(
                `Cookie: ${cookie.key}=${cookie.value.substring(0, 15)}... Domain: ${cookie.domain}, Path: ${cookie.path}, HttpOnly: ${cookie.httpOnly}, Secure: ${cookie.secure}`
            );
        });

        const isValid = await PortalAuthenticator.verifySession(cookieJar, { debug: true });
        expect(isValid).toBe(true);
        console.log('Session verification successful');
    });

    it('should fail authentication with invalid credentials', async () => {
        if (!runTests) {
            return;
        }

        const result = await PortalAuthenticator.authenticateWithPortal(
            'invalid_user',
            'invalid_password'
        );

        expect(result.success).toBe(false);
        expect(result.message).toBeDefined();

        console.log(`Authentication failed as expected with message: ${result.message}`);
    });
});
