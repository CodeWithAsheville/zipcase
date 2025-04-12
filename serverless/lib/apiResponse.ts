import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Creates a standardized API response with correct headers
 *
 * @param statusCode HTTP status code
 * @param body Response body (will be stringified)
 * @param additionalHeaders Optional additional headers to include
 * @returns API Gateway proxy response object
 */
export function createResponse<T>(
    statusCode: number,
    body: T,
    additionalHeaders: Record<string, string> = {}
): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...additionalHeaders,
        },
        body: JSON.stringify(body),
    };
}

/**
 * Creates a successful response (2xx status code)
 */
export function successResponse<T>(
    body: T,
    statusCode: number = 200,
    additionalHeaders: Record<string, string> = {}
): APIGatewayProxyResult {
    return createResponse(statusCode, body, additionalHeaders);
}

/**
 * Creates an error response (4xx, 5xx status code)
 */
export function errorResponse(
    message: string,
    statusCode: number = 500,
    additionalData: Record<string, unknown> = {},
    additionalHeaders: Record<string, string> = {}
): APIGatewayProxyResult {
    return createResponse(
        statusCode,
        {
            error: message,
            ...additionalData,
        },
        additionalHeaders
    );
}
