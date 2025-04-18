/**
 * Tests for the NameSearchProcessor
 */
import { processNameSearchRequest, getNameSearchResults } from '../NameSearchProcessor';
import StorageClient from '../StorageClient';
import QueueClient from '../QueueClient';
import PortalAuthenticator from '../PortalAuthenticator';
import AlertService from '../AlertService';
import NameParser from '../NameParser';
import { NameSearchRequest } from '../../../shared/types/Search';

// Mock dependencies
jest.mock('../StorageClient');
jest.mock('../QueueClient');
jest.mock('../PortalAuthenticator');
jest.mock('../AlertService');
jest.mock('../NameParser');
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('NameSearchProcessor', () => {
    const mockUserId = 'user123';

    beforeEach(() => {
        jest.clearAllMocks();

        // Default mock implementations
        (NameParser.parseAndStandardizeName as jest.Mock).mockImplementation(name => name);
        (StorageClient.getUserSession as jest.Mock).mockResolvedValue(null);
        (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);
        (QueueClient.queueNameSearchForProcessing as jest.Mock).mockResolvedValue(undefined);
        (AlertService.logError as jest.Mock).mockResolvedValue(undefined);
    });

    describe('processNameSearchRequest', () => {
        const mockRequest: NameSearchRequest = {
            name: 'Smith, John',
            dateOfBirth: '1980-01-01',
            soundsLike: false,
            userAgent: 'test-agent'
        };

        it('should return empty result if name is invalid', async () => {
            (NameParser.parseAndStandardizeName as jest.Mock).mockReturnValue('');

            const result = await processNameSearchRequest(mockRequest, mockUserId);

            expect(result).toEqual({
                searchId: '',
                results: {}
            });
            expect(StorageClient.saveNameSearch).not.toHaveBeenCalled();
            expect(QueueClient.queueNameSearchForProcessing).not.toHaveBeenCalled();
        });

        it('should generate search ID and save data for valid name', async () => {
            await processNameSearchRequest(mockRequest, mockUserId);

            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                'mock-uuid-1234',
                expect.objectContaining({
                    originalName: 'Smith, John',
                    normalizedName: 'Smith, John',
                    dateOfBirth: '1980-01-01',
                    soundsLike: false,
                    cases: [],
                    status: 'queued'
                }),
                expect.any(Number)
            );
        });

        it('should queue name search if user session exists', async () => {
            (StorageClient.getUserSession as jest.Mock).mockResolvedValue('existing-session');

            await processNameSearchRequest(mockRequest, mockUserId);

            expect(QueueClient.queueNameSearchForProcessing).toHaveBeenCalledWith(
                'mock-uuid-1234',
                mockUserId,
                'Smith, John',
                '1980-01-01',
                false,
                'test-agent'
            );
            expect(StorageClient.sensitiveGetPortalCredentials).not.toHaveBeenCalled();
        });

        it('should attempt authentication if no user session exists', async () => {
            const mockPortalCredentials = {
                username: 'test-user',
                password: 'test-pass',
                isBad: false
            };
            (StorageClient.getUserSession as jest.Mock).mockResolvedValue(null);
            (StorageClient.sensitiveGetPortalCredentials as jest.Mock).mockResolvedValue(mockPortalCredentials);
            (PortalAuthenticator.authenticateWithPortal as jest.Mock).mockResolvedValue({
                success: true,
                cookieJar: {
                    toJSON: () => ({ cookies: [] })
                }
            });

            await processNameSearchRequest(mockRequest, mockUserId);

            expect(StorageClient.sensitiveGetPortalCredentials).toHaveBeenCalledWith(mockUserId);
            expect(PortalAuthenticator.authenticateWithPortal).toHaveBeenCalledWith(
                'test-user',
                'test-pass',
                { userAgent: 'test-agent' }
            );
            expect(StorageClient.saveUserSession).toHaveBeenCalled();
            expect(QueueClient.queueNameSearchForProcessing).toHaveBeenCalled();
        });

        it('should handle authentication failure', async () => {
            const mockPortalCredentials = {
                username: 'test-user',
                password: 'test-pass',
                isBad: false
            };
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                dateOfBirth: '1980-01-01',
                soundsLike: false,
                cases: []
            };

            (StorageClient.getUserSession as jest.Mock).mockResolvedValue(null);
            (StorageClient.sensitiveGetPortalCredentials as jest.Mock).mockResolvedValue(mockPortalCredentials);
            (PortalAuthenticator.authenticateWithPortal as jest.Mock).mockResolvedValue({
                success: false,
                message: 'Invalid credentials'
            });
            (StorageClient.getNameSearch as jest.Mock).mockImplementation(() => Promise.resolve(mockNameSearch));
            (StorageClient.getNameSearch as jest.Mock).mockImplementationOnce(() => Promise.resolve(mockNameSearch));
            (StorageClient.getNameSearch as jest.Mock).mockImplementationOnce(() => Promise.resolve({
                ...mockNameSearch,
                status: 'failed',
                message: 'Authentication failed: Invalid credentials'
            }));

            const result = await processNameSearchRequest(mockRequest, mockUserId);

            expect(AlertService.logError).toHaveBeenCalled();
            expect(StorageClient.saveNameSearch).toHaveBeenCalledWith(
                'mock-uuid-1234',
                expect.objectContaining({
                    status: 'failed',
                    message: expect.stringContaining('Authentication failed')
                })
            );
            expect(result).toEqual({
                searchId: 'mock-uuid-1234',
                results: {},
                success: false,
                error: expect.stringContaining('Authentication failed')
            });
        });
    });

    describe('getNameSearchResults', () => {
        const mockSearchId = 'search-123';

        it('should return empty results if name search does not exist', async () => {
            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(null);

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: {}
            });
            expect(StorageClient.getSearchResults).not.toHaveBeenCalled();
        });

        it('should fetch and return results for existing name search', async () => {
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                cases: ['123', '456'],
                status: 'complete'
            };
            const mockSearchResults = {
                '123': { zipCase: { caseNumber: '123' } },
                '456': { zipCase: { caseNumber: '456' } }
            };

            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue(mockSearchResults);

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: mockSearchResults,
                success: true
            });
            expect(StorageClient.getSearchResults).toHaveBeenCalledWith(['123', '456']);
        });

        it('should include error in result for failed searches', async () => {
            const mockNameSearch = {
                originalName: 'Smith, John',
                normalizedName: 'Smith, John',
                cases: [],
                status: 'failed',
                message: 'Search failed due to network error'
            };

            (StorageClient.getNameSearch as jest.Mock).mockResolvedValue(mockNameSearch);
            (StorageClient.getSearchResults as jest.Mock).mockResolvedValue({});

            const result = await getNameSearchResults(mockSearchId);

            expect(result).toEqual({
                searchId: mockSearchId,
                results: {},
                success: false,
                error: 'Search failed due to network error'
            });
        });
    });
});