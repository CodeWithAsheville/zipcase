import { APIGatewayProxyHandler } from 'aws-lambda';

// Search handler
export const execute: APIGatewayProxyHandler = async event => {
    try {
        // API endpoints should NOT forward user-agent strings
        // Server-side requests should use the predefined list in PortalAuthenticator

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `search execute handler placeholder: ${event}`,
            }),
        };
    } catch (error) {
        console.error('Error in search handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: (error as Error).message,
            }),
        };
    }
};
