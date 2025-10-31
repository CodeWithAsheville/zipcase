# Case Search 500 Error Troubleshooting Guide

## Overview

This document describes the enhanced logging added to `CaseSearchProcessor.ts` to troubleshoot 500 errors when extracting case IDs from the portal.

## Enhanced Logging Features

### 1. Request ID Tracking

Every portal request now has a unique request ID in the format `{caseNumber}-{timestamp}`, making it easy to trace a specific request through all log entries.

**Log format:** `[{requestId}]` prefix on all related log entries

### 2. Timing Metrics

Comprehensive timing information is captured:

- `searchRequest`: Time taken for the search form submission
- `resultsRequest`: Time taken for fetching search results
- `htmlParse`: Time taken to parse the HTML response
- `totalDuration`: Total time from start to finish

These metrics help identify:

- Network latency issues
- Portal performance problems
- Timeout situations

### 3. Cookie State Logging

At the start of each request, the system logs:

- Number of cookies in the jar
- Cookie names (not values, for security)
- User agent being used

**Example log:**

```json
{
    "caseNumber": "12345",
    "cookieNames": ["ASP.NET_SessionId", "AuthToken"],
    "userAgent": "Mozilla/5.0..."
}
```

### 4. Axios Request/Response Interceptors

Detailed logging for every HTTP request and response:

**Outgoing requests log:**

- HTTP method
- Full URL
- Headers
- Data presence and length

**Incoming responses log:**

- Status code and status text
- Duration (ms)
- Response headers
- Response data length

**Error responses log:**

- Status code (if available)
- Error code (e.g., ECONNABORTED, ETIMEDOUT)
- Error message
- Duration

### 5. Enhanced Error Details for 500 Responses

When a 500 error occurs, the system now captures:

- Full status code and status text
- Response headers (may indicate rate limiting or other server issues)
- Response body preview (first 1000 characters)
- Request duration
- Request ID for correlation

### 6. Race Condition Detection

The system tracks the time between consecutive requests for the same case number:

- Warns if requests for the same case are made within 100ms of each other
- Automatically cleans up tracking data older than 5 minutes
- Helps identify concurrent processing issues

**Example warning:**

```
[12345-1730000000000] POTENTIAL RACE CONDITION: Request for 12345 made 50ms after previous request (< 100ms threshold)
```

### 7. Portal-Specific Error Detection

Enhanced detection and logging for known portal issues:

- "Smart Search is having trouble" error messages
- Missing case links in results
- Missing case ID attributes
- Each gets specific context and timing information

## How to Use This Logging

### Identifying 500 Errors

Look for log entries with:

```
[{requestId}] Search request failed
```

or

```
[{requestId}] Results request failed
```

These will include:

- `status`: The HTTP status code (500)
- `statusText`: The status message
- `headers`: Response headers that may indicate the cause
- `bodyPreview`: First 1000 chars of the error response
- `duration`: How long the request took

### Identifying Race Conditions

Search logs for:

```
POTENTIAL RACE CONDITION
```

This indicates requests are being made too quickly in succession, which could cause the portal to reject requests or behave unexpectedly.

### Tracking Request Flow

Use the request ID to follow a specific case search through the logs:

1. Initial request with cookie state
2. Search form submission (>>> Outgoing request)
3. Search form response (<<< Incoming response)
4. Results page request (>>> Outgoing request)
5. Results page response (<<< Incoming response)
6. HTML parsing and case ID extraction
7. Final result or error

### Analyzing Timing Issues

Compare timing metrics:

- If `searchRequest` or `resultsRequest` > 15000ms, the portal is slow
- If `totalDuration` approaches 20000ms (timeout threshold), requests are timing out
- Unusually fast responses (<100ms) might indicate cached errors or redirects

### Comparing with Insomnia

When comparing with successful Insomnia requests:

1. Check cookie differences (cookieNames in logs)
2. Compare request headers (in >>> Outgoing request logs)
3. Compare response headers (in <<< Incoming response logs)
4. Check for rate limiting headers (X-RateLimit-\*, Retry-After)
5. Compare timing - Insomnia might be slower/faster

## Common Issues to Look For

### 1. Session/Cookie Issues

- Log shows 0 or 1 cookies when multiple are expected
- Missing authentication cookies

### 2. Rate Limiting

- Multiple requests in quick succession (< 100ms apart)
- Response headers contain rate limit information
- 429 or 503 status codes before the 500

### 3. Portal State Issues

- "Smart Search is having trouble" message
- Empty or unexpected response bodies
- Redirects to error pages

### 4. Network/Timeout Issues

- `noResponse: true` in error logs
- `requestTimeout: true` in error logs
- Very high duration values (>15000ms)

### 5. Concurrent Processing

- Same case number appearing in multiple requests simultaneously
- Race condition warnings for the same case

## Log Retention

All enhanced logging uses `console.log` and `console.error`, which are captured by CloudWatch Logs. Error details are also sent to AlertService for centralized monitoring.

## Configuration

- **Request interval threshold:** `MIN_REQUEST_INTERVAL_MS = 100ms`
- **Request timeout:** `20000ms` (axios timeout)
- **Max redirects:** `10`

Adjust these values in `CaseSearchProcessor.ts` if needed based on troubleshooting findings.
