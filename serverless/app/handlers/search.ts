import { APIGatewayProxyHandler, SQSHandler } from 'aws-lambda';
import { processSearch as processSearchQueue } from '../../lib/SearchProcessor';
import { processCaseSearchRequest } from '../../lib/CaseSearchProcessor';

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

        // Get the user agent from the request headers
        const userAgent = event.headers['User-Agent'] || event.headers['user-agent'];

        const result = await processCaseSearchRequest({
            input: body.search,
            userId,
            userAgent,
        });

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

// SQS handler for processing search queue messages
export const processSearch: SQSHandler = processSearchQueue;
