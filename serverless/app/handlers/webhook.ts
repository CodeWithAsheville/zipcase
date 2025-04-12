import { APIGatewayProxyHandler } from 'aws-lambda';
import StorageClient from '../../lib/StorageClient';
import { successResponse, errorResponse } from '../../lib/apiResponse';

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

export const setWebhook: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        if (!event.body) {
            return errorResponse('Missing request body', 400);
        }

        const requestBody = JSON.parse(event.body);
        const { webhookUrl, sharedSecret } = requestBody;

        if (!webhookUrl) {
            return errorResponse('Missing webhook URL', 400);
        }

        if (!isValidUrl(webhookUrl)) {
            return errorResponse('Invalid webhook URL format', 400);
        }

        // Validate shared secret if provided
        const secretValidation = validateSharedSecret(sharedSecret);
        if (!secretValidation.valid) {
            return errorResponse(secretValidation.error || 'Invalid webhook shared secret', 400);
        }

        // Check if API key exists for user
        const apiKey = await StorageClient.getApiKey(userId);

        if (!apiKey?.apiKey) {
            return errorResponse('API key not found. Please create an API key first.', 404);
        }

        if (apiKey?.webhookUrl === webhookUrl && apiKey?.sharedSecret === sharedSecret) {
            return successResponse({}, 204); // no content
        }

        // Update the webhook URL and shared secret
        await StorageClient.saveWebhook(userId, webhookUrl, sharedSecret);

        if (!apiKey.webhookUrl || !apiKey.sharedSecret) {
            return successResponse({}, 201); // created
        }

        return successResponse({}, 200);
    } catch (error) {
        console.error('Error in setWebhook handler:', error);
        return errorResponse('Internal server error', 500, { message: (error as Error).message });
    }
};
