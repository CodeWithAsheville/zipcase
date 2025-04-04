<p align="center">
  <img src="frontend/src/assets/ZipCaseLogo.svg" alt="ZipCase Logo" width="200"/>
</p>

Accelerating access to public court data

## Overview

ZipCase is a web application and API designed to streamline the retrieval of public court case information.

### Key Features

- **Automated Case Search**: Search for cases across multiple jurisdictions
- **Multiple Case Number Formats**: Support for standard (23CR123456-789) and LexisNexis (7892025CR 714844) formats can be pasted from virtually any text source
- **Multi-Stage Processing**: Case links are quickly provided and then full case data are retrieved in the background
- **Real-time Status Updates**: Visual indicators show search progress and results
- **Portal Authentication**: Secure login to court portals to access case data
- **API Access**: Developer API for programmatic access to case data

## Project Structure

The project is organized into several components:

```
/zipcase/
├── frontend/         # React TypeScript application
├── serverless/       # AWS Lambda functions and API
│   ├── api/          # Public API service
│   ├── app/          # Application backend service
│   ├── infra/        # Serverless infrastructure
│   └── lib/          # Shared libraries
├── shared/           # Shared TypeScript types
└── infra/            # Terraform infrastructure
    └── terraform/    # Terraform configurations
```

## Architecture

ZipCase follows a serverless architecture built on AWS:

- **Frontend**: React application served via CloudFront and S3
- **Backend**: AWS Lambda functions with API Gateway
- **Storage**: DynamoDB and S3 for case data and user preferences
- **Authentication**: Cognito for user authentication
- **Queuing**: SQS for asynchronous case processing
- **Infrastructure**: Defined with Terraform and Serverless Framework

### Process Flow

1. User searches for case numbers
2. Case search requests are queued to SQS (CaseSearchQueue)
3. Lambda processes find case IDs and mark cases as "found"
4. Found cases are queued for data retrieval (CaseDataQueue)
5. Case data is processed in parallel and stored in DynamoDB
6. Frontend polls for updates and displays results in real-time

## Documentation

- [Frontend Documentation](./frontend/README.md) - React application setup and deployment
- [Serverless Documentation](./serverless/README.md) - Backend services and API
- [Infrastructure](./infra/terraform) - Terraform resources and configuration

## Getting Started

### Prerequisites

- Node.js 18+
- AWS CLI configured with appropriate credentials
- Terraform (for infrastructure deployment)
- Serverless Framework

### Development Setup

1. Clone the repository

    ```bash
    git clone https://github.com/yourusername/zipcase.git
    cd zipcase
    ```

2. Set up the backend

    ```bash
    cd serverless
    npm install
    ```

3. Set up the frontend

    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4. Deploy infrastructure

    ```bash
    cd infra/terraform/dev
    terraform init
    terraform apply
    ```

5. Deploy services
    ```bash
    cd serverless
    serverless deploy
    ```

For more detailed instructions, see the README files in each subdirectory.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
