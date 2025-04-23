/**
 * Tests for the search handler
 */
import { handler } from '../search';
import { processCaseSearchRequest } from '../../../lib/SearchProcessor';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../../lib/SearchProcessor');

describe('Search Handler', () => {
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
            headers: {
                'User-Agent': 'Jest Test Environment',
            },
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
        const event = createEvent({ search: '22CR123456-789' }, null);

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });

    it('should return 400 if search parameter is missing', async () => {
        const event = createEvent({});

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toBe('Missing search parameter');
    });

    it('should call processCaseSearchRequest and return results', async () => {
        const searchQuery = '22CR123456-789 23CV654321-456';
        const event = createEvent({ search: searchQuery });

        const mockResults = {
            results: {
                '22CR123456-789': {
                    zipCase: {
                        caseNumber: '22CR123456-789',
                        fetchStatus: { status: 'queued' },
                    },
                },
                '23CV654321-456': {
                    zipCase: {
                        caseNumber: '23CV654321-456',
                        fetchStatus: { status: 'queued' },
                    },
                },
            },
        };

        // Mock the processor to return our results
        (processCaseSearchRequest as jest.Mock).mockResolvedValue(mockResults);

        const response = (await handler(
            event as any,
            {} as any,
            () => {}
        )) as APIGatewayProxyResult;

        expect(processCaseSearchRequest).toHaveBeenCalledWith({
            input: searchQuery,
            userId: 'test-user-id',
            userAgent: expect.any(String),
        });
        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toEqual(mockResults);
    });

    it('should handle errors and return 500 status', async () => {
        const event = createEvent({ search: '22CR123456-789' });

        // Mock the processor to throw an error
        (processCaseSearchRequest as jest.Mock).mockRejectedValue(new Error('Test error'));

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