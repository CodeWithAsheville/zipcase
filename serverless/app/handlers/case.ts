import { APIGatewayProxyHandler, SQSHandler, SQSEvent } from 'aws-lambda';
import StorageClient from '../../lib/StorageClient';
import PortalAuthenticator from '../../lib/PortalAuthenticator';
import QueueClient from '../../lib/QueueClient';
import CaseProcessor from '../../lib/CaseProcessor';
import { successResponse, errorResponse } from '../../lib/apiResponse';
import { SearchResult, ZipCase } from '../../../shared/types';

/**
 * Processes SQS queue events for case searching (finding caseId)
 */
export const processCaseSearch: SQSHandler = async (event: SQSEvent, context, callback) => {
    return CaseProcessor.processCaseSearch(event, context, callback);
};

/**
 * Processes SQS queue events for case data retrieval
 */
export const processCaseData: SQSHandler = async (event: SQSEvent, context, callback) => {
    return CaseProcessor.processCaseData(event, context, callback);
};

/**
 * Processes SQS queue events for name searches
 */
export const processNameSearch: SQSHandler = async (event: SQSEvent, context, callback) => {
    return CaseProcessor.processNameSearch(event, context, callback);
};

export const get: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const caseNumber = event.pathParameters?.caseNumber;

        if (!caseNumber) {
            return errorResponse('Missing case number', 400);
        }

        // Check for stored case
        const searchResult = await StorageClient.getSearchResult(caseNumber);

        if (searchResult) {
            // If status is complete, return 200, otherwise 202 (still processing)
            const statusCode = searchResult.zipCase.fetchStatus.status === 'complete' ? 200 : 202;
            return successResponse(searchResult, statusCode);
        }

        // Check whether user already has an active session
        const userSession = await StorageClient.getUserSession(userId);

        if (userSession) {
            await QueueClient.queueCaseForSearch(caseNumber, userId);
            return successResponse<SearchResult>(
                {
                    zipCase: {
                        caseNumber,
                        fetchStatus: { status: 'queued' },
                    },
                },
                202
            );
        }

        // No active session, check for saved portal credentials
        const portalCredentials = await StorageClient.sensitiveGetPortalCredentials(userId);

        if (portalCredentials) {
            try {
                const authResult = await PortalAuthenticator.authenticateWithPortal(
                    portalCredentials.username,
                    portalCredentials.password
                );

                if (!authResult.success || !authResult.cookieJar) {
                    console.error(
                        `Failed to authenticate with portal for user ${userId}`,
                        authResult.message
                    );
                    throw new Error(
                        `Authentication failed: ${authResult.message || 'Unknown error'}`
                    );
                }

                // Store the session token (cookie jar)
                const sessionToken = JSON.stringify(authResult.cookieJar.toJSON());

                // Calculate expiration time (24 hours from now)
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

                await StorageClient.saveUserSession(userId, sessionToken, expiresAt);
                console.log(`Successfully authenticated and stored session for user ${userId}`);

                const zipCase: ZipCase = {
                    caseNumber,
                    fetchStatus: { status: 'queued' },
                };

                await StorageClient.saveCase(zipCase);
                await QueueClient.queueCaseForSearch(caseNumber, userId);

                return successResponse<SearchResult>({ zipCase }, 202);
            } catch (error) {
                console.error(`Failed to authenticate with portal for user ${userId}:`, error);

                return errorResponse('Authentication failed', 401, {
                    message: `Failed to authenticate with portal: ${(error as Error).message}`,
                    data: {
                        caseNumber,
                        fetchStatus: { status: 'failed', message: 'Authentication failed' },
                    },
                });
            }
        }

        // No session and no portal credentials
        return errorResponse('Portal credentials required', 403, {
            message: 'Please set up your portal credentials to fetch case data',
            data: {
                caseNumber,
                fetchStatus: {
                    status: 'failed',
                    message: 'Portal credentials required',
                },
            },
        });
    } catch (error) {
        console.error('Error in getCase handler:', error);

        return errorResponse('Internal server error', 500, {
            message: (error as Error).message,
            data: event.pathParameters?.caseNumber
                ? {
                      caseNumber: event.pathParameters.caseNumber,
                      fetchStatus: {
                          status: 'failed',
                          message: 'Internal server error',
                      },
                  }
                : null,
        });
    }
};
