import { APIGatewayProxyHandler } from 'aws-lambda';

// Search handler
export const execute: APIGatewayProxyHandler = async () => {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'search execute handler placeholder' }),
    };
};
