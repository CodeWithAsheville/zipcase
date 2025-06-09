import { APIGatewayProxyHandler } from 'aws-lambda';
import { processNameSearchRequest, getNameSearchResults } from '../../lib/NameSearchProcessor';

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
        if (!body.name) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing name parameter' }),
            };
        }

        // Get the user agent from the request headers
        const userAgent = event.headers['User-Agent'] || event.headers['user-agent'];

        const result = await processNameSearchRequest(
            {
                name: body.name,
                dateOfBirth: body.dateOfBirth,
                soundsLike: !!body.soundsLike,
                userAgent,
            },
            userId
        );

        return {
            statusCode: 202, // Accepted
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(result),
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

export const statusHandler: APIGatewayProxyHandler = async event => {
    try {
        // Extract user ID from Cognito authorizer
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' }),
            };
        }

        const searchId = event.pathParameters?.searchId;

        if (!searchId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing search ID parameter' }),
            };
        }

        const result = await getNameSearchResults(searchId);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(result),
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
