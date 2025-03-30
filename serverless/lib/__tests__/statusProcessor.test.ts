/**
 * Tests for the StatusProcessor module
 */
import { getStatusForCases } from '../StatusProcessor';
import StorageClient from '../StorageClient';

// Mock the dependencies
jest.mock('../StorageClient');

describe('StatusProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getStatusForCases', () => {
        it('should fetch case statuses without re-queuing', async () => {
            // Mock data
            const caseNumbers = ['22CR123456-789', '23CV654321-456'];
            const mockResults = {
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
            };

            // Set up mocks
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue(mockResults);

            // Call the function
            const result = await getStatusForCases({
                caseNumbers,
            });

            // Verify the results
            expect(result).toEqual({ results: mockResults });
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith(caseNumbers);
        });

        it('should handle errors and return empty results', async () => {
            // Mock data
            const caseNumbers = ['22CR123456-789'];

            // Set up mocks to throw an error
            (StorageClient.getSearchResults as jest.Mock).mockRejectedValue(
                new Error('Test error')
            );

            // Call the function
            const result = await getStatusForCases({
                caseNumbers,
            });

            // Verify the results - should return empty results on error
            expect(result).toEqual({ results: {} });
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith(caseNumbers);
        });

        it('should handle empty case numbers array', async () => {
            // Call the function with empty array
            const result = await getStatusForCases({
                caseNumbers: [],
            });

            // Verify that getSearchResults was still called with empty array
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith([]);
            expect(result).toHaveProperty('results');
        });
    });
});
