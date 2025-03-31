# ZipCase CI/CD Workflows

This directory contains GitHub Actions workflows for ZipCase CI/CD processes.

## Configuration Instructions

### Setting Up GitHub Environments

Before the workflows can run properly, you need to set up two GitHub environments:

1. Go to your GitHub repository → Settings → Environments
2. Create two environments: `dev` and `prod`
3. For the `prod` environment:
   - Enable "Required reviewers" and add appropriate team members
   - Restrict deployment to the `live` branch only

### Setting Up Environment Secrets

For each environment, you need to add the following secrets:

#### Dev Environment
- `AWS_ACCESS_KEY_ID` - AWS access key for the development account
- `AWS_SECRET_ACCESS_KEY` - AWS secret key for the development account

#### Prod Environment
- `AWS_ACCESS_KEY_ID` - AWS access key for the production account
- `AWS_SECRET_ACCESS_KEY` - AWS secret key for the production account

### Creating AWS IAM Users for GitHub Actions

Before setting up the secrets, you need to create IAM users in both AWS accounts:

1. Navigate to `infra/terraform/bootstrap`
2. For the dev account:
   ```bash
   terraform init
   terraform apply -var="aws_profile=zipcase-dev"
   ```
3. Create access keys in the AWS console for the created user
4. Add keys to GitHub environment secrets

5. For the prod account:
   ```bash
   terraform init
   terraform apply -var="aws_profile=zipcase-prod"
   ```
6. Create access keys in the AWS console for the created user
7. Add keys to GitHub environment secrets

## Workflows

### Pull Request Checks (`pr-checks.yml`)
- Runs on pull requests to `main` and `live` branches
- Runs backend tests (excluding integration tests)
- Runs frontend tests and linting
- Runs Terraform plan for the appropriate environment

### Automatic Deployment (`deploy.yml`)
- Triggered on pushes to `main` (deploys to dev) and `live` (deploys to prod) branches
- Verifies required SSM parameters
- Applies Terraform changes
- Deploys serverless backend
- Builds and deploys the frontend
- Creates a release when deploying to production

### Manual Test (`manual-test.yml`)
- Manually triggered workflow that allows testing any branch
- Runs backend tests (excluding integration tests)
- Runs frontend tests and linting

### Manual Deploy (`manual-deploy.yml`)
- Manually triggered workflow that allows deploying any branch to any environment
- Requires selecting a branch and an environment (dev or prod)
- Performs the same deployment steps as the automatic deployment workflow