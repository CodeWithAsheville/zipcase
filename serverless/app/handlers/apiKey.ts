import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    APIGatewayClient,
    CreateApiKeyCommand,
    CreateUsagePlanKeyCommand,
    UpdateApiKeyCommand,
} from '@aws-sdk/client-api-gateway';
import StorageClient from '../../lib/StorageClient';
import { successResponse, errorResponse } from '../../lib/apiResponse';
import UserAgentClient from '../../lib/UserAgentClient';

const apiGatewayClient = new APIGatewayClient({ region: process.env.AWS_REGION || 'us-east-2' });

// Helper function to validate a URL
function isValidUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

// Helper function to validate webhook shared secret
function validateSharedSecret(secret: string | undefined): {
    valid: boolean;
    trimmed?: string;
    error?: string;
} {
    if (!secret) {
        return { valid: true, trimmed: '' };
    }

    const trimmedSecret = secret.trim();

    if (trimmedSecret.length > 128) {
        return { valid: false, error: 'Webhook shared secret must not exceed 128 characters' };
    }

    return { valid: true, trimmed: trimmedSecret };
}

export const get: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const apiKeyData = await StorageClient.getApiKey(userId);

        if (!apiKeyData) {
            return successResponse({}, 204);
        }

        return successResponse({
            apiKey: apiKeyData.apiKey,
            webhookUrl: apiKeyData.webhookUrl || '',
            sharedSecret: apiKeyData.sharedSecret || '',
        });
    } catch (error) {
        console.error('Error in getApiKey handler:', error);
        return errorResponse('Internal server error', 500, { message: (error as Error).message });
    }
};

export const create: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        let webhookUrl = '';
        let webhookSharedSecret = '';

        if (event.body) {
            try {
                const requestBody = JSON.parse(event.body);

                // Extract webhook URL and shared secret if provided
                if (requestBody.webhookUrl) {
                    if (!isValidUrl(requestBody.webhookUrl)) {
                        return errorResponse('Invalid webhook URL format', 400);
                    }
                    webhookUrl = requestBody.webhookUrl;
                }

                // Validate webhook shared secret if provided
                if (requestBody.webhookSharedSecret !== undefined) {
                    const secretValidation = validateSharedSecret(requestBody.webhookSharedSecret);
                    if (!secretValidation.valid) {
                        return errorResponse(secretValidation.error || 'Invalid webhook shared secret', 400);
                    }
                    webhookSharedSecret = secretValidation.trimmed || '';
                }
            } catch {
                return errorResponse('Invalid request body format', 400);
            }
        }

        const existingApiKeyId = await StorageClient.getApiKeyId(userId);

        const newKeyResult = await apiGatewayClient.send(
            new CreateApiKeyCommand({
                enabled: true,
                name: `user-${userId}-${Date.now()}`,
                description: `API key for user ${userId}`,
                stageKeys: [],
            })
        );

        if (!newKeyResult.id || !newKeyResult.value) {
            throw new Error('Failed to create API key');
        }

        // Associate the new key with an API Gateway usage plan
        const usagePlanId = process.env.DEFAULT_USAGE_PLAN_ID || 'test';
        await apiGatewayClient.send(
            new CreateUsagePlanKeyCommand({
                keyId: newKeyResult.id,
                keyType: 'API_KEY',
                usagePlanId,
            })
        );

        await StorageClient.saveApiKey(userId, newKeyResult.id, newKeyResult.value);

        // Save webhook settings if provided
        if (webhookUrl || webhookSharedSecret) {
            await StorageClient.saveWebhook(userId, webhookUrl, webhookSharedSecret);
            console.log(`Stored webhook settings for user ${userId}`);
        }

        // Store the user agent from the request
        const userAgent = event.headers['User-Agent'] || event.headers['user-agent'];
        if (userAgent) {
            await StorageClient.saveUserAgent(userId, userAgent);
            console.log(`Stored user agent for user ${userId}`);
        } else {
            // If no user agent in the request, initialize with one from the collection
            await UserAgentClient.getUserAgent(userId);
            console.log(`Initialized user agent for user ${userId} from collection`);
        }

        // If a previous key existed, disable it
        if (existingApiKeyId) {
            await apiGatewayClient.send(
                new UpdateApiKeyCommand({
                    apiKey: existingApiKeyId,
                    patchOperations: [
                        {
                            op: 'replace',
                            path: '/enabled',
                            value: 'false',
                        },
                    ],
                })
            );
        }

        return successResponse(
            {
                apiKey: newKeyResult.value,
            },
            existingApiKeyId ? 200 : 201
        );
    } catch (error) {
        console.error('Error in createApiKey handler:', error);
        return errorResponse('Internal server error', 500, { message: (error as Error).message });
    }
};
