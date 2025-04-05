/**
 * Tests for the name-search handlers
 */
import { handler, statusHandler } from '../name-search';
import { processNameSearchRequest, getNameSearchResults } from '../../../lib/NameSearchProcessor';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../../lib/NameSearchProcessor');

describe('Name Search Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Helper function to create API Gateway event for name search
    const createEvent = (
        body: any,
        userId: string | null = 'test-user-id'
    ): Partial<APIGatewayProxyEvent> => {
        return {
            body: JSON.stringify(body),
            headers: {
                'User-Agent': 'Jest Test Environment'
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

    // Helper function to create API Gateway event for status check
    const createStatusEvent = (
        searchId: string | null,
        userId: string | null = 'test-user-id'
    ): Partial<APIGatewayProxyEvent> => {
        return {
            pathParameters: searchId ? { searchId } : {},
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

    describe('Name Search Request Handler', () => {
        it('should return 401 if no user ID is present', async () => {
            const event = createEvent({ name: 'John Doe' }, null);

            const response = (await handler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Unauthorized');
        });

        it('should return 400 if name parameter is missing', async () => {
            const event = createEvent({});

            const response = (await handler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('Missing name parameter');
        });

        it('should call processNameSearchRequest and return results', async () => {
            const name = 'John Smith';
            const dateOfBirth = '1980-01-01';
            const soundsLike = true;

            const event = createEvent({
                name,
                dateOfBirth,
                soundsLike
            });

            const mockResults = {
                searchId: 'test-search-id',
                results: {},
                success: true
            };

            // Mock the processor to return our results
            (processNameSearchRequest as jest.Mock).mockResolvedValue(mockResults);

            const response = (await handler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(processNameSearchRequest).toHaveBeenCalledWith(
                {
                    name,
                    dateOfBirth,
                    soundsLike: true,
                    userAgent: expect.any(String)
                },
                'test-user-id'
            );
            expect(response.statusCode).toBe(202);
            expect(JSON.parse(response.body)).toEqual(mockResults);
        });

        it('should handle errors and return 500 status', async () => {
            const event = createEvent({ name: 'John Doe' });

            // Mock the processor to throw an error
            (processNameSearchRequest as jest.Mock).mockImplementation(() => {
                throw new Error('Test error');
            });

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

    describe('Name Search Status Handler', () => {
        it('should return 401 if no user ID is present', async () => {
            const event = createStatusEvent('test-search-id', null);

            const response = (await statusHandler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(401);
            expect(JSON.parse(response.body).error).toBe('Unauthorized');
        });

        it('should return 400 if searchId parameter is missing', async () => {
            const event = createStatusEvent(null);

            const response = (await statusHandler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('Missing search ID parameter');
        });

        it('should call getNameSearchResults and return results', async () => {
            const searchId = 'test-search-id';
            const event = createStatusEvent(searchId);

            const mockResults = {
                searchId,
                results: {
                    '23CR123456': {
                        zipCase: {
                            caseNumber: '23CR123456',
                            fetchStatus: { status: 'complete' },
                        }
                    }
                }
            };

            // Mock the processor to return our results
            (getNameSearchResults as jest.Mock).mockResolvedValue(mockResults);

            const response = (await statusHandler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(getNameSearchResults).toHaveBeenCalledWith(searchId);
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual(mockResults);
        });

        it('should handle errors and return 500 status', async () => {
            const searchId = 'test-search-id';
            const event = createStatusEvent(searchId);

            // Mock the processor to throw an error
            (getNameSearchResults as jest.Mock).mockImplementation(() => {
                throw new Error('Test error');
            });

            const response = (await statusHandler(
                event as any,
                {} as any,
                () => {}
            )) as APIGatewayProxyResult;

            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.body).error).toBe('Internal server error');
            expect(JSON.parse(response.body).message).toBe('Test error');
        });
    });
});