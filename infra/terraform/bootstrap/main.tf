provider "aws" {
  region = var.aws_region
}

# Create IAM user for GitHub Actions
resource "aws_iam_user" "github_actions" {
  name = "github-actions-zipcase"
  path = "/service-accounts/"

  tags = {
    Description = "Service account for GitHub Actions CI/CD pipelines"
    Service     = "ZipCase"
    ManagedBy   = "Terraform"
  }
}

# IAM policy for GitHub Actions
resource "aws_iam_policy" "github_actions_policy" {
  name        = "ZipCaseGitHubActionsPolicy"
  description = "Policy that grants permissions needed for ZipCase GitHub Actions workflows"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 permissions for frontend deployment, Terraform state, and Serverless state/deployment
      {
        Effect = "Allow"
        Action = [
          "s3:*"
        ]
        Resource = [
          "arn:aws:s3:::zipcase-frontend-*",
          "arn:aws:s3:::zipcase-frontend-*/*",
          "arn:aws:s3:::zipcase-tf-state-*",
          "arn:aws:s3:::zipcase-tf-state-*/*",
          "arn:aws:s3:::serverless-framework-state-*",
          "arn:aws:s3:::serverless-framework-state-*/*",
          "arn:aws:s3:::zipcase-serverless-deployments-*",
          "arn:aws:s3:::zipcase-serverless-deployments-*/*"
        ]
      },

      # S3 bucket creation permissions
      {
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:ListAllMyBuckets",
          "s3:HeadBucket"
        ]
        Resource = "*"
      },

      # CloudFront permissions for cache invalidation and origin access control
      {
        Effect = "Allow"
        Action = [
          "cloudfront:*"
        ]
        Resource = "*"
      },

      # CloudFormation permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "cloudformation:*"
        ]
        Resource = "*"
      },

      # SSM Parameter Store permissions
      {
        Effect = "Allow"
        Action = [
          "ssm:*"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:*:parameter/zipcase/*",
          "arn:aws:ssm:us-east-1:*:parameter/zipcase/*"
        ]
      },

      # Serverless Framework SSM permissions
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:PutParameter"
        ]
        Resource = [
          "arn:aws:ssm:us-east-1:*:parameter/serverless-framework/*",
          "arn:aws:ssm:${var.aws_region}:*:parameter/serverless-framework/*"
        ]
      },

      # Additional SSM permissions for DescribeParameters (requires * resource)
      {
        Effect = "Allow"
        Action = [
          "ssm:DescribeParameters"
        ]
        Resource = "*"
      },

      # DynamoDB permissions for Terraform state locking
      {
        Effect = "Allow"
        Action = [
          "dynamodb:*"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/terraform-state-lock"
      },

      # Lambda permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "lambda:*"
        ]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:*:function:zipcase-*",
          "arn:aws:lambda:${var.aws_region}:*:function:api-*",
          "arn:aws:lambda:${var.aws_region}:*:function:app-*",
          "arn:aws:lambda:${var.aws_region}:*:function:infra-*"
        ]
      },

      # API Gateway permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "apigateway:*"
        ]
        Resource = "*"
      },

      # IAM permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "iam:*"
        ]
        Resource = [
          "arn:aws:iam::*:role/zipcase-*",
          "arn:aws:iam::*:role/api-*",
          "arn:aws:iam::*:role/app-*",
          "arn:aws:iam::*:role/infra-*"
        ]
      },

      # Additional IAM permissions for managed policies
      {
        Effect = "Allow"
        Action = [
          "iam:ListPolicies",
          "iam:ListEntitiesForPolicy",
          "iam:GetPolicy"
        ]
        Resource = "arn:aws:iam::aws:policy/service-role/*"
      },

      # CloudWatch Logs permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "logs:*"
        ]
        Resource = [
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/zipcase-*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/zipcase-*:*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/api-*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/api-*:*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/app-*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/app-*:*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/infra-*",
          "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/infra-*:*"
        ]
      },

      # CloudWatch Metrics and Alarms permissions
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:GetMetricData",
          "cloudwatch:ListMetrics",
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      },

      # SQS permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "sqs:*"
        ]
        Resource = [
          "arn:aws:sqs:${var.aws_region}:*:zipcase-*",
          "arn:aws:sqs:${var.aws_region}:*:infra-*"
        ]
      },

      # Route53 permissions (if needed for custom domains)
      {
        Effect = "Allow"
        Action = [
          "route53:*"
        ]
        Resource = "*"
      },

      # ACM Certificate permissions
      {
        Effect = "Allow"
        Action = [
          "acm:*"
        ]
        Resource = "*"
      },

      # DynamoDB permissions for application
      {
        Effect = "Allow"
        Action = [
          "dynamodb:*"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/zipcase-*"
      },

      # Cognito permissions for user pool management
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:*"
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:*:userpool/*"
      },

      # Additional Cognito permissions that require wildcard resources
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUserPools",
          "cognito-idp:DescribeUserPoolDomain",
          "cognito-idp:ListUserPoolClients"
        ]
        Resource = "*"
      },

      # KMS permissions for Serverless Framework
      {
        Effect = "Allow"
        Action = [
          "kms:*"
        ]
        Resource = "*"
      },

      # Additional required permissions for Serverless Framework services
      {
        Effect = "Allow"
        Action = [
          "lambda:*",
          "events:*",
          "cloudformation:*"
        ]
        Resource = "*"
      },

      # SNS permissions for accessing topic attributes
      {
        Effect = "Allow"
        Action = [
          "sns:*"
        ]
        Resource = "arn:aws:sns:${var.aws_region}:*:zipcase-alerts-prod"
      }
    ]
  })
}

# Attach the policy to the user
resource "aws_iam_user_policy_attachment" "github_actions_policy_attachment" {
  user       = aws_iam_user.github_actions.name
  policy_arn = aws_iam_policy.github_actions_policy.arn
}

# Output instructions for creating access keys
output "instructions" {
  value = <<EOT
===========================================================================
  GitHub Actions CI/CD IAM User Setup Complete
===========================================================================

An IAM user named '${aws_iam_user.github_actions.name}' has been created with
the necessary permissions for GitHub Actions workflows.

To complete setup:
1. Sign in to the AWS Management Console
2. Navigate to IAM → Users → ${aws_iam_user.github_actions.name}
3. Select "Security credentials" tab
4. Under "Access keys", click "Create access key"
5. Select "Command Line Interface (CLI)" as use case
6. Click through the wizard to create the access key
7. IMPORTANT: Download or copy the Access Key ID and Secret Access Key
   These will ONLY be shown once!
8. Add these as environment secrets in your GitHub repository:
   - AWS_ACCESS_KEY_ID
   - AWS_SECRET_ACCESS_KEY

===========================================================================
EOT
}
