import { APIGatewayProxyHandler } from 'aws-lambda';
import { processSearchRequest } from '../../lib/SearchProcessor';

export const handler: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' }),
            };
        }

        const body = JSON.parse(event.body || '{}');
        if (!body.search) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing search parameter' }),
            };
        }

        const result = await processSearchRequest({ input: body.search, userId });

        return {
            statusCode: 202, // Accepted
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(result),
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
