# ZipCase Frontend

React application for ZipCase.

## Development

```bash
# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local
# Edit .env.local with your local development settings

# Start development server
npm run dev
```

### Environment Variables

The application uses environment variables for configuration:

- `API_URL`: The URL for the backend API
- `PORTAL_URL`: The URL for the court portal
- `PORTAL_CASE_URL`: The URL for case data in the court portal
- `COGNITO_USER_POOL_ID`: Cognito User Pool ID
- `COGNITO_CLIENT_ID`: Cognito Client ID

Note: For local development, configured with Vite, these will be prepended with `VITE_`

For local development:

1. Copy `.env.example` to `.env.local`
2. Edit `.env.local` with your specific configuration

For production deployment:

1. These values are injected during the CI/CD build process
2. The values are sourced from AWS SSM Parameter Store or similar

## Deployment

### First-time setup

1. Deploy the infrastructure:

```bash
# Navigate to terraform directory
cd ../infra/terraform/dev

# Initialize terraform
terraform init

# Apply terraform configuration
terraform apply -var-file=variables.tfvars
```

### Deploying new changes

```bash
# Build and deploy to dev environment
npm run deploy:dev
```

This script:

1. Builds the React application
2. Syncs the build files to the S3 bucket
3. Invalidates the CloudFront distribution cache

## Production Deployment

To deploy to production, create a similar `deploy:prod` script in package.json:

```json
"deploy:prod": "npm run build && aws s3 sync dist/ s3://zipcase-frontend-prod && aws cloudfront create-invalidation --distribution-id YOUR_PROD_DISTRIBUTION_ID --paths \"/*\""
```

## Infrastructure

The frontend is deployed to AWS with the following components:

- S3 bucket for static file hosting (in your default region)
- CloudFront distribution for content delivery
- Route53 for DNS configuration
- ACM certificate in us-east-1 (required for CloudFront)

### Domain Structure

The frontend uses the following domain pattern:

- Development: `dev.zipcase.org`
- Production: `zipcase.org` (root domain)

### Note on Regions

While most of your resources are in us-east-2, CloudFront requires certificates to be in us-east-1. The Terraform configuration handles this by:

1. Creating a new ACM certificate in us-east-1 specifically for CloudFront
2. Creating a dedicated Route53 zone for the frontend domain
3. Setting up DNS validation records in this zone
4. Waiting for certificate validation before creating the CloudFront distribution

This multi-region approach is a standard pattern for AWS CloudFront deployments.

### DNS Configuration

After deploying the infrastructure, you'll need to configure your domain registrar to point to the AWS nameservers for your frontend domain. The nameservers can be found in the AWS Console under Route53 > Hosted zones > [your frontend domain] > NS record.
