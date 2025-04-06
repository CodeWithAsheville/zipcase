/**
 * AlertService - Centralized error monitoring and notification service
 *
 * This service provides:
 * 1. Standardized error logging with severity levels
 * 2. Automatic CloudWatch Metrics publication for critical errors
 * 3. Deduplication of similar errors within a time window
 * 4. Configurable alert thresholds by error type
 */
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Initialize AWS clients
const cloudWatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-2' });
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-2' });
const ssm = new SSMClient({ region: process.env.AWS_REGION || 'us-east-2' });

// Error severity levels
export enum Severity {
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR',
    CRITICAL = 'CRITICAL',
}

// Alert categories for grouping similar errors
export enum AlertCategory {
    AUTHENTICATION = 'AUTH',
    DATABASE = 'DB',
    NETWORK = 'NET',
    PORTAL = 'PORTAL',
    QUEUE = 'QUEUE',
    SYSTEM = 'SYS',
}

// Error context to provide additional information
export type ErrorContext = Record<string, unknown>;

// In-memory cache for deduplication
interface ErrorCache {
    [key: string]: {
        count: number;
        firstSeen: number;
        lastSeen: number;
        lastReported: number;
    };
}

// Cache errors for 15 minutes by default
const ERROR_CACHE_TTL_MS = 15 * 60 * 1000;
// Only report duplicate errors after 10 occurrences or 5 minutes
const ERROR_REPORT_THRESHOLD = 10;
const ERROR_REPORT_INTERVAL_MS = 5 * 60 * 1000;

// In-memory cache for deduplication
const errorCache: ErrorCache = {};

// Clean up cache periodically (every 5 minutes)
setInterval(
    () => {
        const now = Date.now();
        Object.keys(errorCache).forEach(key => {
            if (now - errorCache[key].lastSeen > ERROR_CACHE_TTL_MS) {
                delete errorCache[key];
            }
        });
    },
    5 * 60 * 1000
);

/**
 * Generate a unique key for an error based on message and category
 */
function generateErrorKey(message: string, category: AlertCategory): string {
    // Strip out dynamic values that might make errors seem different
    const normalizedMessage = message
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'UUID') // Remove UUIDs
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'DATE') // Remove dates
        .replace(/\b\d{2}:\d{2}:\d{2}\b/g, 'TIME') // Remove times
        .replace(/[0-9]{5,}/g, 'NUMBER') // Remove long numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

    return `${category}:${normalizedMessage}`;
}

/**
 * Publish a metric to CloudWatch
 */
async function publishMetric(
    name: string,
    value: number,
    unit: 'Count' | 'None' = 'Count',
    dimensions: Array<{ Name: string; Value: string }> = []
): Promise<void> {
    try {
        const command = new PutMetricDataCommand({
            Namespace: `ZipCase/${process.env.STAGE || 'dev'}`,
            MetricData: [
                {
                    MetricName: name,
                    Value: value,
                    Unit: unit,
                    Dimensions: dimensions,
                    Timestamp: new Date(),
                },
            ],
        });

        await cloudWatch.send(command);
    } catch (error) {
        // Don't use the alert service here to avoid infinite loops
        console.error('Failed to publish CloudWatch metric:', error);
    }
}

/**
 * Send an alert notification via SNS
 */
async function sendAlert(
    severity: Severity,
    category: AlertCategory,
    message: string,
    count: number = 1,
    context?: ErrorContext
): Promise<void> {
    try {
        // Get SNS topic from parameter store
        const alertTopicArnParam = await ssm.send(
            new GetParameterCommand({
                Name: '/zipcase/alert-topic-arn',
                WithDecryption: false,
            })
        );

        const alertTopicArn = alertTopicArnParam.Parameter?.Value;

        if (!alertTopicArn) {
            console.error('Alert topic ARN not found in parameter store');
            return;
        }

        // Prepare detailed message
        const timestamp = new Date().toISOString();
        const environmentInfo = {
            stage: process.env.STAGE || 'dev',
            region: process.env.AWS_REGION || 'us-east-2',
            service: process.env.SERVICE_NAME || 'unknown',
        };

        // Create meaningful subject that summarizes the issue
        const subject = `[ZipCase ${environmentInfo.stage}] ${severity} ${category}: ${message.substring(0, 80)}`;

        // Build more detailed message body with context
        const messageBody = {
            timestamp,
            severity,
            category,
            message,
            count,
            context,
            environment: environmentInfo,
        };

        // Publish to SNS
        await sns.send(
            new PublishCommand({
                TopicArn: alertTopicArn,
                Subject: subject,
                Message: JSON.stringify(messageBody, null, 2),
                MessageAttributes: {
                    severity: {
                        DataType: 'String',
                        StringValue: severity,
                    },
                    category: {
                        DataType: 'String',
                        StringValue: category,
                    },
                },
            })
        );
    } catch (error) {
        // Don't use the alert service here to avoid infinite loops
        console.error('Failed to send alert notification:', error);
    }
}

const AlertService = {
    /**
     * Log an error and potentially trigger an alert
     *
     * @param severity The severity level of the error
     * @param category The category the error belongs to
     * @param message The error message
     * @param error Optional Error object for stack trace
     * @param context Optional context about the error
     */
    async logError(
        severity: Severity,
        category: AlertCategory,
        message: string,
        error?: Error,
        context?: ErrorContext
    ): Promise<void> {
        // Always log the error
        if (severity === Severity.INFO) {
            console.log(`[${category}] ${message}`, context);
        } else if (severity === Severity.WARNING) {
            console.warn(`[${category}] ${message}`, error?.message || '', context);
        } else {
            console.error(
                `[${category}] ${message}`,
                error?.message || '',
                error?.stack || '',
                context
            );
        }

        // Generate error key for deduplication
        const errorKey = generateErrorKey(message, category);
        const now = Date.now();

        // Update error cache
        if (!errorCache[errorKey]) {
            errorCache[errorKey] = {
                count: 1,
                firstSeen: now,
                lastSeen: now,
                lastReported: 0, // Never reported yet
            };
        } else {
            errorCache[errorKey].count += 1;
            errorCache[errorKey].lastSeen = now;
        }

        // Publish metric to CloudWatch for all errors
        await publishMetric('Errors', 1, 'Count', [
            { Name: 'Severity', Value: severity },
            { Name: 'Category', Value: category },
        ]);

        // Determine if we should send an alert
        const cached = errorCache[errorKey];
        const exceedsThreshold = cached.count >= ERROR_REPORT_THRESHOLD;
        const exceedsTimeInterval = now - cached.lastReported > ERROR_REPORT_INTERVAL_MS;

        // Send alerts for:
        // 1. All CRITICAL errors immediately
        // 2. ERROR level when they exceed threshold or time interval
        // 3. WARNING level only when they exceed a higher threshold
        if (
            severity === Severity.CRITICAL ||
            (severity === Severity.ERROR && (exceedsThreshold || exceedsTimeInterval)) ||
            (severity === Severity.WARNING && cached.count >= ERROR_REPORT_THRESHOLD * 2)
        ) {
            await sendAlert(severity, category, message, cached.count, context);
            errorCache[errorKey].lastReported = now;
        }
    },

    /**
     * Create a scoped logger for a specific category
     */
    forCategory(category: AlertCategory) {
        return {
            info: (message: string, context?: ErrorContext) =>
                this.logError(Severity.INFO, category, message, undefined, context),

            warn: (message: string, error?: Error, context?: ErrorContext) =>
                this.logError(Severity.WARNING, category, message, error, context),

            error: (message: string, error?: Error, context?: ErrorContext) =>
                this.logError(Severity.ERROR, category, message, error, context),

            critical: (message: string, error?: Error, context?: ErrorContext) =>
                this.logError(Severity.CRITICAL, category, message, error, context),
        };
    },
};

export default AlertService;
