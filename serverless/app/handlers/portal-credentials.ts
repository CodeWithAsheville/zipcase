import { APIGatewayProxyHandler } from 'aws-lambda';
import PortalAuthenticator from '../../lib/PortalAuthenticator';
import StorageClient from '../../lib/StorageClient';
import { successResponse, errorResponse } from '../../lib/apiResponse';

/**
 * Authenticate with the portal using WS-Federation flow
 */
async function authenticatePortal(
    username: string,
    password: string
): Promise<{
    success: boolean;
    sessionToken?: string;
    error?: string;
}> {
    console.log(`Attempting to authenticate user ${username} with WS-Federation flow`);

    try {
        // Use the WS-Federation authentication flow implementation
        const authResult = await PortalAuthenticator.authenticateWithPortal(username, password, {
            debug: process.env.DEBUG === 'true',
        });

        if (authResult.success && authResult.cookieJar) {
            // Use the cookie jar serialized as the session token
            const sessionToken = JSON.stringify(authResult.cookieJar.toJSON());
            return {
                success: true,
                sessionToken,
            };
        } else {
            const errorMessage = authResult.message || 'Authentication failed';

            console.error(`Authentication error: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    } catch (error) {
        console.error('Unexpected authentication error:', error);
        return {
            success: false,
            error: `Authentication failed: ${(error as Error).message}`,
        };
    }
}

export const get: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const credentials = await StorageClient.getPortalCredentials(userId);

        if (!credentials) {
            return successResponse({}, 204);
        }

        return successResponse({
            username: credentials.username,
            isBad: credentials.isBad,
        });
    } catch (error) {
        console.error('Error in getPortalCredentials handler:', error);
        return errorResponse('Internal server error', 500, { message: (error as Error).message });
    }
};

export const set: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        // Parse request body
        const body = JSON.parse(event.body || '{}');

        // Validate input
        if (
            !body.username ||
            !body.password ||
            body.username.trim() === '' ||
            body.password.trim() === ''
        ) {
            return errorResponse('Username and password are required', 400);
        }

        // Attempt authentication with the portal
        const authResult = await authenticatePortal(body.username, body.password);

        if (!authResult.success) {
            return errorResponse('Authentication failed', 401, {
                message: authResult.error || 'Invalid credentials',
            });
        }

        // Store the credentials
        await StorageClient.savePortalCredentials(userId, body.username, body.password);

        // Parse the session token (it's a JSON string of the cookie jar)
        const cookieJarJson = JSON.parse(authResult.sessionToken!);

        // Find the earliest cookie expiration time
        let earliestExpiry: number | null = null;
        let expirationMs = 24 * 60 * 60 * 1000; // Default: 24 hours

        if (cookieJarJson.cookies && cookieJarJson.cookies.length > 0) {
            // Loop through cookies and find the earliest expiration
            for (const cookie of cookieJarJson.cookies) {
                if (cookie.expires) {
                    const expiryTime = new Date(cookie.expires).getTime();
                    if (earliestExpiry === null || expiryTime < earliestExpiry) {
                        earliestExpiry = expiryTime;
                    }
                }
            }

            // If we found an expiration time, calculate TTL (add small buffer for timing discrepancies)
            if (earliestExpiry !== null) {
                expirationMs = Math.max(0, earliestExpiry - Date.now() - 5 * 60 * 1000); // 5 min buffer
                console.log(`Using cookie-based session expiration: ${expirationMs}ms`);
            }
        }

        // Calculate expiry ISO date string
        const expiryDate = new Date(Date.now() + expirationMs);
        const expiresAtIso = expiryDate.toISOString();

        // Store the session
        await StorageClient.saveUserSession(userId, authResult.sessionToken!, expiresAtIso);

        return successResponse(
            {
                message: 'Credentials stored successfully',
                username: body.username,
            },
            201 // Created status code
        );
    } catch (error) {
        console.error('Error in setPortalCredentials handler:', error);
        return errorResponse('Internal server error', 500, { message: (error as Error).message });
    }
};
