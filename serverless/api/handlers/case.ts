import { APIGatewayProxyHandler } from 'aws-lambda';

// Case handler
export const get: APIGatewayProxyHandler = async () => {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'case get handler placeholder' }),
    };
};
