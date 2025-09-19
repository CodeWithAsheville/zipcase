import AlertService, { Severity, AlertCategory } from '../AlertService';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudwatch', () => ({
    CloudWatchClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({}),
    })),
    PutMetricDataCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-sns', () => ({
    SNSClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({}),
    })),
    PublishCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({
            Parameter: {
                Value: 'arn:aws:sns:us-east-2:123456789012:test-topic',
            },
        }),
    })),
    GetParameterCommand: jest.fn(),
}));

describe('AlertService', () => {
    // Spy on console methods
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    beforeEach(() => {
        console.log = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();
    });

    afterEach(() => {
        console.log = originalConsoleLog;
        console.warn = originalConsoleWarn;
        console.error = originalConsoleError;
    });

    describe('logError', () => {
        it('should log errors with the correct severity', async () => {
            await AlertService.logError(Severity.INFO, AlertCategory.SYSTEM, 'Info message');

            await AlertService.logError(Severity.WARNING, AlertCategory.NETWORK, 'Warning message', new Error('Network warning'));

            await AlertService.logError(Severity.ERROR, AlertCategory.PORTAL, 'Error message', new Error('Portal error'));

            expect(console.log).toHaveBeenCalledWith('[SYS] Info message', undefined);

            expect(console.warn).toHaveBeenCalledWith('[NET] Warning message', 'Network warning', undefined);

            expect(console.error).toHaveBeenCalledWith(
                '[PORTAL] Error message',
                'Portal error',
                expect.stringContaining('Error: Portal error'),
                undefined
            );
        });
    });

    describe('forCategory', () => {
        it('should create a scoped logger for a specific category', async () => {
            const authLogger = AlertService.forCategory(AlertCategory.AUTHENTICATION);

            expect(typeof authLogger.info).toBe('function');
            expect(typeof authLogger.warn).toBe('function');
            expect(typeof authLogger.error).toBe('function');
            expect(typeof authLogger.critical).toBe('function');

            await authLogger.error('Authentication failed', new Error('Bad credentials'), { userId: 'test-user' });

            expect(console.error).toHaveBeenCalledWith(
                '[AUTH] Authentication failed',
                'Bad credentials',
                expect.stringContaining('Error: Bad credentials'),
                { userId: 'test-user' }
            );
        });
    });
});
