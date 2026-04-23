/**
 * Tests for the AwsWafChallengeSolver module
 */
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockSsmSend = jest.fn();

// Mock AWS SDK
jest.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: jest.fn().mockImplementation(() => ({
        send: mockSsmSend,
    })),
    GetParameterCommand: jest.fn(),
}));

// Mock AlertService
jest.mock('../AlertService', () => ({
    __esModule: true,
    default: {
        logError: jest.fn(),
    },
    Severity: {
        CRITICAL: 'CRITICAL',
        ERROR: 'ERROR',
        WARNING: 'WARNING',
        INFO: 'INFO',
    },
    AlertCategory: {
        SYSTEM: 'SYSTEM',
        PORTAL: 'PORTAL',
        AUTHENTICATION: 'AUTHENTICATION',
    },
}));

describe('AwsWafChallengeSolver', () => {
    const loadSolverContext = async () => ({
        AwsWafChallengeSolver: (await import('../AwsWafChallengeSolver')).AwsWafChallengeSolver,
        mockedAxios: (await import('axios')).default as jest.Mocked<typeof axios>,
        mockedAlertService: (await import('../AlertService')).default,
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockSsmSend.mockReset();
    });

    describe('detectChallenge', () => {
        it('should detect challenge with 405 status code', () => {
            const { AwsWafChallengeSolver } = require('../AwsWafChallengeSolver');
            const mockResponse = {
                data: '<html>Some content</html>',
                status: 405,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with gokuProps', () => {
            const { AwsWafChallengeSolver } = require('../AwsWafChallengeSolver');
            const mockResponse = {
                data: '<html><script>window.gokuProps = {"key": "test"}</script></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with challenge.js', () => {
            const { AwsWafChallengeSolver } = require('../AwsWafChallengeSolver');
            const mockResponse = {
                data: '<html><script src="https://example.com/challenge.js"></script></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with aws-waf-token', () => {
            const { AwsWafChallengeSolver } = require('../AwsWafChallengeSolver');
            const mockResponse = {
                data: '<html><input name="aws-waf-token" value="test"></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should not detect challenge in normal response', () => {
            const { AwsWafChallengeSolver } = require('../AwsWafChallengeSolver');
            const mockResponse = {
                data: '<html><body>Normal page content</body></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(false);
        });
    });

    describe('solveChallenge', () => {
        it('should create a CapSolver task with only websiteURL', async () => {
            const { AwsWafChallengeSolver, mockedAxios } = await loadSolverContext();
            mockSsmSend.mockResolvedValue({
                Parameter: {
                    Value: 'test-api-key',
                },
            });

            mockedAxios.post
                .mockResolvedValueOnce({
                    data: {
                        errorId: 0,
                        taskId: 'task-123',
                    },
                } as any)
                .mockResolvedValueOnce({
                    data: {
                        errorId: 0,
                        status: 'ready',
                        solution: {
                            cookie: 'solved-cookie',
                        },
                    },
                } as any);

            const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
                callback();
                return 0 as any;
            });

            const result = await AwsWafChallengeSolver.solveChallenge('https://example.com/login', { maxRetries: 1, retryDelay: 1 });

            expect(result).toEqual({
                success: true,
                cookie: 'solved-cookie',
            });

            expect(mockedAxios.post).toHaveBeenNthCalledWith(
                1,
                'https://api.capsolver.com/createTask',
                {
                    clientKey: 'test-api-key',
                    task: {
                        type: 'AntiAwsWafTaskProxyLess',
                        websiteURL: 'https://example.com/login',
                    },
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000,
                }
            );

            setTimeoutSpy.mockRestore();
        });

        it('should handle solving errors gracefully', async () => {
            const { AwsWafChallengeSolver, mockedAlertService } = await loadSolverContext();
            mockSsmSend.mockRejectedValue(new Error('SSM error'));

            const result = await AwsWafChallengeSolver.solveChallenge('https://example.com', '<html>challenge content</html>');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(mockedAlertService.logError).toHaveBeenCalled();
        });

        // Note: We can't easily test the full solving flow without mocking the entire
        // CapSolver API interaction, but this validates the error handling paths
    });
});
