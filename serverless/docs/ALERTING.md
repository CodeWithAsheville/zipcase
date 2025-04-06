# ZipCase Alerting System

ZipCase includes a centralized alerting system that monitors errors, provides observability, and sends notifications about critical issues. This document explains how the alerting system works and how to use it in your code.

## Overview

The alerting system consists of:

1. **AlertService**: A TypeScript module for standardized error logging
2. **CloudWatch Metrics**: For tracking error rates and triggering alarms
3. **CloudWatch Alarms**: For automated monitoring of error thresholds
4. **SNS Notifications**: For delivering alerts via email

## Key Features

- **Severity Levels**: INFO, WARNING, ERROR, and CRITICAL
- **Error Categories**: Authentication, Database, Network, Portal, Queue, System
- **Automatic Deduplication**: Similar errors are grouped to prevent alert fatigue
- **Configurable Thresholds**: Different thresholds for different severity levels
- **Contextual Metadata**: Errors include relevant context like userId, caseNumber, etc.
- **Email Notifications**: Critical errors trigger immediate email alerts

## Using the AlertService

The AlertService is designed to be easy to use while providing robust error monitoring. Here's how to integrate it into your code:

### Basic Usage

```typescript
import AlertService, { Severity, AlertCategory } from './AlertService';

// Log a simple error
await AlertService.logError(
  Severity.ERROR,
  AlertCategory.DATABASE,
  'Failed to save case data',
  error, // Optional Error object
  { caseNumber: '22CR123456' } // Optional context
);
```

### Category-Specific Loggers

For cleaner code, you can create a logger for a specific category:

```typescript
// Create a logger for portal-related issues
const portalLogger = AlertService.forCategory(AlertCategory.PORTAL);

// Use the scoped logger
await portalLogger.error('Failed to connect to portal', error);
await portalLogger.info('Successfully retrieved case data');
```

### Severity Guidelines

- **INFO**: Informational messages that don't indicate problems
- **WARNING**: Non-critical issues that might need attention
- **ERROR**: Problems that affect functionality but aren't system failures
- **CRITICAL**: Severe problems that require immediate attention

### Context Object

The context object helps provide relevant information about the error:

```typescript
{
  userId?: string;      // The affected user
  caseNumber?: string;  // The case number involved
  searchId?: string;    // ID of the search operation
  resource?: string;    // The resource/component having issues
  operationId?: string; // A unique ID for the operation
  metadata?: object;    // Any additional data
}
```

## CloudWatch Alarms

The system includes two types of alarms:

### Application-Level Alarms (via AlertService)

1. **AuthenticationErrorAlarm**: Triggers when authentication errors exceed normal rates
2. **PortalCriticalErrorAlarm**: Monitors for critical portal connectivity issues
3. **SystemErrorAlarm**: Alerts on high rates of system errors
4. **DatabaseErrorAlarm**: Tracks database connectivity issues

### Infrastructure-Level Alarms (AWS Service Metrics)

1. **LambdaErrorsAlarm**: Monitors all Lambda function errors
2. **LambdaThrottlesAlarm**: Alerts when Lambda functions are being throttled
3. **ApiGateway5xxErrorsAlarm**: Detects server errors in API Gateway
4. **CaseProcessingDLQAlarm**: Monitors for messages in the Dead Letter Queue
5. **Per-Function Alarms**:
   - processCaseSearch-Errors: Issues with search queue processing
   - processCaseData-Errors: Issues with case data retrieval
   - postSearch-Errors: Problems with the search API endpoint

These infrastructure alarms will catch issues outside the application code, such as:
- Unhandled exceptions that crash Lambda functions
- Memory/timeout issues
- API Gateway configuration problems
- Messages that repeatedly fail processing

## Email Notifications

Email alerts are sent via Amazon SNS and include:

- Severity level and category
- Error message
- Timestamp
- Context information
- Environment information (stage, region, service)

## Configuration

The alerting system requires these SSM parameters:

- `/zipcase/alert-email`: Email address for notifications
- `/zipcase/alert-topic-arn`: SNS topic ARN (created automatically)

## Error Deduplication

To prevent alert fatigue, the system deduplicates similar errors:

- Errors are grouped by message pattern and category
- Dynamic values like UUIDs and timestamps are normalized
- A cached count of similar errors is maintained
- Alerts are sent only after thresholds are exceeded or time intervals pass

## Best Practices

1. **Use Appropriate Severity Levels**: Don't mark everything as CRITICAL
2. **Include Relevant Context**: Add userId, caseNumber, etc. when available
3. **Be Specific in Messages**: Error messages should be descriptive
4. **Log Early, Log Often**: Instrument critical code paths
5. **Group Related Errors**: Use consistent categories and message patterns

## Dashboard

CloudWatch automatically creates dashboards for the metrics. You can view:

- Error rates by severity and category
- Alarm history and current state
- Error trends over time