# ZipCase Serverless Backend

This directory contains the serverless backend services for ZipCase, built using AWS Lambda, API Gateway, and the Serverless Framework.

## Architecture

The backend is organized into multiple services:

- **API Service**: Public API for third-party integrations (`/api`)
- **App Service**: Application backend for the web application (`/app`)
- **Infrastructure**: Shared cloud resources (`/infra`)

### Service Components

```
/serverless/
├── api/                 # Public API service
│   ├── handlers/        # API Lambda function handlers
│   └── serverless.yml   # API service configuration
├── app/                 # Application backend service
│   ├── handlers/        # App Lambda function handlers
│   └── serverless.yml   # App service configuration
├── infra/               # Shared infrastructure
│   └── serverless.yml   # Infrastructure resources
├── lib/                 # Shared code libraries
│   ├── CaseProcessor.ts # Case processing logic
│   ├── QueueClient.ts   # SQS queue client
│   └── StorageClient.ts # DynamoDB storage client
└── serverless-compose.yml # Service composition
```

## Processing Workflow

The backend implements a two-stage processing workflow:

1. **Case Search Stage**:
   - Requests are queued in the CaseSearchQueue
   - The `processCaseSearch` Lambda finds case IDs in court portals
   - Cases are updated with a 'found' status once IDs are located
   - Found cases are queued for data retrieval

2. **Case Data Stage**:
   - Found cases are processed by the CaseDataQueue
   - The `processCaseData` Lambda retrieves full case details
   - Cases are updated with a 'complete' status
   - Processing can happen in parallel for multiple cases

## Deployment

Each service can be deployed individually or as a group:

```bash
# Deploy all services
serverless deploy

# Deploy a specific service
cd app
serverless deploy

# Deploy to a specific stage
serverless deploy --stage prod
```

### Environment Variables

Key environment variables used by the services:

- `CASE_SEARCH_QUEUE_URL`: SQS queue for case search requests
- `CASE_DATA_QUEUE_URL`: SQS queue for case data retrieval
- `ZIPCASE_DATA_TABLE`: DynamoDB table for case data
- `PORTAL_URL`: URL for the court portal

## Local Development

```bash
# Start local development server
serverless offline

# Run tests
npm test

# Run integration tests
npm run test:integration
```

## Development Tools

### Linting

Run ESLint to check for code style and potential issues:

```bash
npm run lint
```

### Type Checking

Verify TypeScript types with the TypeScript compiler:

```bash
npx tsc --noEmit
```

### Testing

Run tests for the backend services:

```bash
# Run all unit tests
npm test

# Run a specific test file
npm test -- path/to/test-file.test.ts

# Run tests with coverage report
npm test -- --coverage

# Run integration tests (these are typically skipped in CI)
npm run test:integration
```

Test files are located in:
- `/lib/__tests__/` - Unit tests for shared libraries
- `/app/handlers/__tests__/` - Unit tests for app handlers
- `/api/handlers/__tests__/` - Unit tests for api handlers
- `/__integration_tests__/` - Integration tests

### Development Workflow

For thorough checking before committing, run the following sequence:

```bash
npm run lint && npx tsc --noEmit && npm test
```

## API Documentation

### App API Endpoints

- `POST /search` - Submit case numbers for searching
- `GET /case/{caseNumber}` - Retrieve case information
- `GET /portal-credentials` - Get portal credentials
- `POST /portal-credentials` - Set portal credentials
- `GET /api-key` - Get API key
- `POST /api-key` - Create API key
- `GET /webhook` - Get webhook configuration
- `POST /webhook` - Set webhook configuration

### Public API Endpoints

- `POST /search` - Submit search (requires API key)
- `GET /case/{caseNumber}` - Get case (requires API key)

For more information, see the API handlers and serverless.yml configurations.