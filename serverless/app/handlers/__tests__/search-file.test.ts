/**
 * Tests for the file search handler
 */
import { fileHandler } from '../search';
import { processFileSearchRequest } from '../../../lib/FileSearchProcessor';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../../lib/FileSearchProcessor');

describe('File Search Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createEvent = (body: any, userId: string | null = 'test-user-id'): Partial<APIGatewayProxyEvent> => {
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
        const event = createEvent({ key: 'uploads/test.pdf' }, null);

        const response = (await fileHandler(event as any, {} as any, () => {})) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });

    it('should return 400 if key parameter is missing', async () => {
        const event = createEvent({});

        const response = (await fileHandler(event as any, {} as any, () => {})) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toBe('Missing key parameter');
    });

    it('should call processFileSearchRequest and return results', async () => {
        const fileKey = 'uploads/test.pdf';
        const event = createEvent({ key: fileKey });

        const mockResults = {
            results: {
                '22CR123456-789': {
                    zipCase: {
                        caseNumber: '22CR123456-789',
                        fetchStatus: { status: 'queued' },
                    },
                },
            },
        };

        (processFileSearchRequest as jest.Mock).mockResolvedValue(mockResults);

        const response = (await fileHandler(event as any, {} as any, () => {})) as APIGatewayProxyResult;

        expect(processFileSearchRequest).toHaveBeenCalledWith({
            fileKey,
            userId: 'test-user-id',
            userAgent: expect.any(String),
        });
        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toEqual(mockResults);
    });

    it('should handle errors and return 500 status', async () => {
        const event = createEvent({ key: 'uploads/test.pdf' });

        (processFileSearchRequest as jest.Mock).mockRejectedValue(new Error('Test error'));

        const response = (await fileHandler(event as any, {} as any, () => {})) as APIGatewayProxyResult;

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body).error).toBe('Internal server error');
        expect(JSON.parse(response.body).message).toBe('Test error');
    });
});
