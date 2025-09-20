import { APIGatewayProxyHandler } from 'aws-lambda';

// Name search handler
export const execute: APIGatewayProxyHandler = async event => {
    try {
        const body = JSON.parse(event.body || '{}');

        return {
            statusCode: 202, // Accepted
            body: JSON.stringify({
                message: 'Name search execute handler placeholder',
                searchRequest: body,
            }),
        };
    } catch (error) {
        console.error('Error in name search handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: (error as Error).message,
            }),
        };
    }
};

// Name search status handler
export const status: APIGatewayProxyHandler = async event => {
    try {
        const searchId = event.pathParameters?.searchId;

        if (!searchId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing search ID' }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Name search status handler placeholder',
                searchId,
            }),
        };
    } catch (error) {
        console.error('Error in name search status handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: (error as Error).message,
            }),
        };
    }
};
