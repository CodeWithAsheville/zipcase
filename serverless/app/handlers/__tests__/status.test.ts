/**
 * Tests for the status handler
 */
import { handler } from '../status';
import { getStatusForCases } from '../../../lib/StatusProcessor';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../../lib/StatusProcessor');

describe('Status Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Helper function to create API Gateway event
    const createEvent = (
        body: any,
        userId: string | null = 'test-user-id'
    ): Partial<APIGatewayProxyEvent> => {
        return {
            body: JSON.stringify(body),
            requestContext: {
                authorizer: {
                    jwt: {
                        claims: {
                            sub: userId,
                        },
                    },
                },
            } as any,
        };
    };

    it('should return 401 if no user ID is present', async () => {
        const event = createEvent({ caseNumbers: ['22CR123456-789'] }, null);

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });

    it('should return 400 if caseNumbers parameter is missing', async () => {
        const event = createEvent({});

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toContain('Missing or invalid caseNumbers');
    });

    it('should return 400 if caseNumbers is not an array', async () => {
        const event = createEvent({ caseNumbers: 'not-an-array' });

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toContain('Missing or invalid caseNumbers');
    });

    it('should return 400 if caseNumbers is an empty array', async () => {
        const event = createEvent({ caseNumbers: [] });

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toContain('Missing or invalid caseNumbers');
    });

    it('should call getStatusForCases and return results', async () => {
        const caseNumbers = ['22CR123456-789', '23CV654321-456'];
        const event = createEvent({ caseNumbers });

        const mockResults = {
            results: {
                '22CR123456-789': {
                    zipCase: {
                        caseNumber: '22CR123456-789',
                        fetchStatus: { status: 'complete' },
                    },
                },
                '23CV654321-456': {
                    zipCase: {
                        caseNumber: '23CV654321-456',
                        fetchStatus: { status: 'processing' },
                    },
                },
            },
        };

        // Mock the processor to return our results
        (getStatusForCases as jest.Mock).mockResolvedValue(mockResults);

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(getStatusForCases).toHaveBeenCalledWith({ caseNumbers });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual(mockResults);
    });

    it('should handle errors and return 500 status', async () => {
        const caseNumbers = ['22CR123456-789'];
        const event = createEvent({ caseNumbers });

        // Mock the processor to throw an error
        (getStatusForCases as jest.Mock).mockRejectedValue(new Error('Test error'));

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body).error).toBe('Internal server error');
        expect(JSON.parse(response.body).message).toBe('Test error');
    });
});
