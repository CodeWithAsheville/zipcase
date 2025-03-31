# ZipCase GitHub Actions CI/CD Bootstrap

This Terraform configuration sets up the necessary AWS IAM resources for GitHub Actions CI/CD pipelines.

## What This Creates

- An IAM user specifically for GitHub Actions (`github-actions-zipcase`)
- A custom IAM policy with permissions required for ZipCase deployments
- Instructions for creating access keys manually

## Usage Instructions

### For Development Environment

```bash
# Initialize Terraform
terraform init

# Review changes
terraform plan -var="aws_profile=zipcase-dev"

# Apply changes
terraform apply -var="aws_profile=zipcase-dev"
```

### For Production Environment

```bash
# Initialize Terraform
terraform init

# Review changes
terraform plan -var="aws_profile=zipcase-prod"

# Apply changes
terraform apply -var="aws_profile=zipcase-prod"
```

## After Applying

1. Follow the instructions in the output to create access keys in the AWS console
2. Add the access keys as secrets in your GitHub repository:
   - `AWS_ACCESS_KEY_ID_DEV` and `AWS_SECRET_ACCESS_KEY_DEV` for development
   - `AWS_ACCESS_KEY_ID_PROD` and `AWS_SECRET_ACCESS_KEY_PROD` for production

## Security Note

This approach separates the IAM user creation (automated) from the access key creation (manual) for better security. Access keys are never stored in Terraform state files.

## Permissions Included

The IAM policy includes permissions for:

- S3 (frontend deployment and Terraform state)
- CloudFront (cache invalidation)
- CloudFormation (reading outputs)
- Lambda, API Gateway, IAM (Serverless deployments)
- SSM Parameter Store (reading configuration)
- DynamoDB (application data and Terraform state locking)
- CloudWatch Logs
- SQS
- Cognito
- Route53 (domain management)