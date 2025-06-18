# AWS WAF Challenge Solver Integration

## Overview

This document describes the integration of a generic AWS WAF challenge solver into the ZipCase court portal authentication flow. The system currently uses CapSolver as the backend provider but is designed to be easily switchable to other providers.

## Architecture

The solution is built with a modular architecture:

- **AwsWafChallengeSolver**: Generic service that provides a common interface for WAF challenge solving
- **CapSolverProvider**: Current implementation using CapSolver's API
- **PortalAuthenticator**: Uses the generic solver service during authentication

This design allows for easy provider switching without changing the core authentication logic.

## Integration Point

The AWS WAF challenge solver is integrated into `/serverless/lib/PortalAuthenticator.ts` after the login page fetch:

    - Detects AWS WAF challenges in the initial login page response
    - Solves the challenge and adds the resulting cookie to the session
    - Re-fetches the login page with the WAF cookie

## Implementation Details

### Generic AWS WAF Challenge Solver (`AwsWafChallengeSolver`)

A new generic service provides the main interface:

- **Provider Pattern**: Uses the strategy pattern to support different backend providers
- **Challenge Detection**: Identifies AWS WAF challenges in HTTP responses
- **Challenge Solving**: Delegates to the configured provider for actual solving
- **Error Handling**: Comprehensive error handling with logging

### CapSolver Provider Implementation

The current implementation uses CapSolver with the following features:

- **API Key Management**: Retrieves API keys from AWS SSM Parameter Store
- **Challenge Parsing**: Extracts challenge data from various AWS WAF challenge formats
- **Solution Polling**: Polls CapSolver API for task completion and retrieves solutions

### AWS WAF Challenge Detection

The system detects AWS WAF challenges by looking for:

- HTTP 405 status codes
- `window.gokuProps` JavaScript objects
- `challenge.js` script URLs
- `captcha.js` script URLs
- `visualSolutionsRequired` indicators
- `awswaf.com` domain references
- `aws-waf-token` strings

### Challenge Types Supported

The integration supports multiple AWS WAF challenge formats:

1. **Situation 1**: JavaScript challenges with `gokuProps` (key, iv, context)
2. **Situation 3**: Challenge.js URLs
3. **Situation 4**: Visual solutions with problem URLs

## Configuration

### Environment Variables

- `WAF_SOLVER_API_KEY_PARAMETER`: SSM parameter path (default: `/zipcase/waf-solver/api-key`)
- `AWS_REGION`: AWS region for SSM client (default: `us-east-2`)

### SSM Parameter Setup

Store your CapSolver API key in AWS SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name "/zipcase/waf-solver/api-key" \
  --value "your-capsolver-api-key" \
  --type "SecureString" \
  --description "WAF challenge solver API key"
```

## Switching Providers

To use a different WAF challenge solver provider:

1. **Implement the Interface**: Create a new class implementing `IAwsWafChallengeSolver`
2. **Set the Provider**: Use `AwsWafChallengeSolver.setProvider(new YourProvider())`
3. **Update Configuration**: Modify SSM parameter names as needed

Example:

```typescript
import { AwsWafChallengeSolver, IAwsWafChallengeSolver } from './AwsWafChallengeSolver';

class CustomSolverProvider implements IAwsWafChallengeSolver {
    detectChallenge(response: AxiosResponse): boolean {
        // Your detection logic
    }

    async solveChallenge(
        websiteURL: string,
        htmlContent: string
    ): Promise<WafChallengeSolverResult> {
        // Your solving logic
    }
}

// Switch to your provider
AwsWafChallengeSolver.setProvider(new CustomSolverProvider());
```

## API Usage

### CapSolver API Endpoints

1. **Create Task**: `POST https://api.capsolver.com/createTask`
2. **Get Result**: `POST https://api.capsolver.com/getTaskResult`

### Task Configuration

```typescript
{
  clientKey: "your-api-key",
  task: {
    type: "AntiAwsWafTaskProxyLess",
    websiteURL: "https://portal.example.com/login",
    awsKey: "extracted-from-challenge",
    awsIv: "extracted-from-challenge",
    awsContext: "extracted-from-challenge",
    awsChallengeJS: "https://challenge-url.js",
    awsProblemUrl: "https://problem-url"
  }
}
```

## Error Handling

The integration includes comprehensive error handling:

- **API Key Retrieval Failures**: Logged as CRITICAL errors
- **Challenge Solving Failures**: Logged as ERROR level
- **Graceful Degradation**: Authentication continues even if WAF solving fails
- **Timeout Protection**: Maximum 30 polling attempts (2.5 minutes)

## Logging and Monitoring

All CapSolver operations are logged with appropriate severity levels:

- CRITICAL: API key retrieval failures
- ERROR: Challenge solving failures
- INFO: Successful challenge resolution

## Testing

### Unit Tests

Run the specific tests for the AWS WAF Challenge Solver:

```bash
cd /home/jay/dev/zipcase/serverless
npm test -- lib/__tests__/AwsWafChallengeSolver.test.ts
```

### Integration Tests

The existing portal authentication tests should continue to pass:

```bash
npm test -- lib/__tests__/portalAuthenticator.test.ts
```

### Full Test Suite

Run all tests to ensure the integration doesn't break existing functionality:

```bash
npm test
```

### Manual Testing

To test the integration manually:

1. Ensure your CapSolver API key is configured in SSM
2. Run a portal authentication with debug enabled
3. Monitor logs for WAF challenge detection and resolution

## Dependencies

The integration uses existing dependencies:

- `@aws-sdk/client-ssm`: For API key retrieval
- `axios`: For CapSolver API calls
- `cheerio`: For HTML parsing (challenge detection)

## Security Considerations

- API keys are stored securely in AWS SSM Parameter Store with encryption
- No sensitive data is logged in plain text
- Challenge data is parsed safely to prevent XSS
- Timeout limits prevent indefinite polling

## Performance Impact

- Challenge detection adds minimal overhead (simple string checks)
- Challenge solving only occurs when WAF challenges are detected
- Polling is limited to 2.5 minutes maximum
- Failed solving attempts don't block authentication

## Monitoring and Alerts

The integration leverages the existing AlertService for:

- API key retrieval failures
- Challenge solving failures
- Authentication flow errors

Monitor these alerts to ensure the CapSolver integration is functioning properly.

## Troubleshooting

### Common Issues

1. **API Key Not Found**

    - Verify SSM parameter exists and is accessible
    - Check IAM permissions for SSM access

2. **Challenge Detection False Positives**

    - Review detection criteria in `detectAwsWafChallenge`
    - Adjust detection logic if needed

3. **Solving Timeout**

    - Check CapSolver service status
    - Verify API key balance and limits

4. **Authentication Still Failing**
    - Enable debug logging to see detailed flow
    - Check if WAF challenges are being detected correctly

### Debug Logging

Enable debug logging in portal authentication:

```typescript
const result = await PortalAuthenticator.authenticateWithPortal(username, password, {
    debug: true,
});
```

## Next Steps

1. **Production Deployment**: Deploy the updated PortalAuthenticator to production
2. **Monitoring Setup**: Configure alerts for CapSolver integration metrics
3. **Performance Tuning**: Monitor and optimize challenge detection and solving
4. **Documentation Updates**: Update API documentation with WAF handling details

## Support

For CapSolver-specific issues:

- CapSolver Documentation: https://docs.capsolver.com/
- Support: Contact CapSolver support team

For integration issues:

- Review logs in CloudWatch
- Check AlertService notifications
- Validate SSM parameter configuration
