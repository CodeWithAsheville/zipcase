import { APIGatewayProxyHandler } from 'aws-lambda';
import { getStatusForCases } from '../../lib/StatusProcessor';

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
        if (!body.caseNumbers || !Array.isArray(body.caseNumbers) || body.caseNumbers.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing or invalid caseNumbers array parameter' }),
            };
        }

        // Pass directly to the status processor without re-parsing the input
        const result = await getStatusForCases({
            caseNumbers: body.caseNumbers,
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(result),
        };
    } catch (error) {
        console.error('Error in status handler:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: (error as Error).message,
            }),
        };
    }
};
