/**
 * Tests for the AwsWafChallengeSolver module
 */
import { AwsWafChallengeSolver } from '../AwsWafChallengeSolver';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock AWS SDK
jest.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: jest.fn().mockImplementation(() => ({
        send: jest.fn(),
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
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('detectChallenge', () => {
        it('should detect challenge with 405 status code', () => {
            const mockResponse = {
                data: '<html>Some content</html>',
                status: 405,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with gokuProps', () => {
            const mockResponse = {
                data: '<html><script>window.gokuProps = {"key": "test"}</script></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with challenge.js', () => {
            const mockResponse = {
                data: '<html><script src="https://example.com/challenge.js"></script></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should detect challenge with aws-waf-token', () => {
            const mockResponse = {
                data: '<html><input name="aws-waf-token" value="test"></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(true);
        });

        it('should not detect challenge in normal response', () => {
            const mockResponse = {
                data: '<html><body>Normal page content</body></html>',
                status: 200,
            } as any;

            const result = AwsWafChallengeSolver.detectChallenge(mockResponse);
            expect(result).toBe(false);
        });
    });

    describe('solveChallenge', () => {
        it('should handle solving errors gracefully', async () => {
            // Mock SSM to throw an error
            const mockSSMClient = require('@aws-sdk/client-ssm').SSMClient;
            mockSSMClient.mockImplementation(() => ({
                send: jest.fn().mockRejectedValue(new Error('SSM error')),
            }));

            const result = await AwsWafChallengeSolver.solveChallenge(
                'https://example.com',
                '<html>challenge content</html>'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        // Note: We can't easily test the full solving flow without mocking the entire
        // CapSolver API interaction, but this validates the error handling paths
    });
});
