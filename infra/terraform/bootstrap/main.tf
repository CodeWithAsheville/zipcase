terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  required_version = ">= 1.5.0"
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
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
      # S3 permissions for frontend deployment and Terraform state
      {
        Effect   = "Allow"
        Action   = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::zipcase-frontend-*",
          "arn:aws:s3:::zipcase-frontend-*/*",
          "arn:aws:s3:::zipcase-terraform-state",
          "arn:aws:s3:::zipcase-terraform-state/*"
        ]
      },
      
      # CloudFront permissions for cache invalidation
      {
        Effect   = "Allow"
        Action   = [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations"
        ]
        Resource = "*"
      },
      
      # CloudFormation permissions to read exports
      {
        Effect   = "Allow"
        Action   = [
          "cloudformation:ListExports",
          "cloudformation:ListStacks"
        ]
        Resource = "*"
      },
      
      # SSM Parameter Store permissions
      {
        Effect   = "Allow"
        Action   = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/zipcase/*"
      },
      
      # DynamoDB permissions for Terraform state locking
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/zipcase-terraform-lock"
      },
      
      # Lambda permissions for Serverless Framework
      {
        Effect   = "Allow"
        Action   = [
          "lambda:AddPermission",
          "lambda:CreateFunction",
          "lambda:DeleteFunction",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:InvokeFunction",
          "lambda:ListVersionsByFunction",
          "lambda:PublishVersion",
          "lambda:RemovePermission",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration"
        ]
        Resource = "arn:aws:lambda:${var.aws_region}:*:function:*"
      },
      
      # API Gateway permissions for Serverless Framework
      {
        Effect   = "Allow"
        Action   = [
          "apigateway:GET",
          "apigateway:POST",
          "apigateway:PUT",
          "apigateway:DELETE",
          "apigateway:PATCH"
        ]
        Resource = [
          "arn:aws:apigateway:${var.aws_region}::/restapis",
          "arn:aws:apigateway:${var.aws_region}::/restapis/*",
          "arn:aws:apigateway:${var.aws_region}::/apis",
          "arn:aws:apigateway:${var.aws_region}::/apis/*"
        ]
      },
      
      # IAM permissions for Serverless Framework
      {
        Effect   = "Allow"
        Action   = [
          "iam:GetRole",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:PassRole"
        ]
        Resource = "arn:aws:iam::*:role/zipcase-*"
      },
      
      # CloudWatch Logs permissions for Serverless Framework
      {
        Effect   = "Allow"
        Action   = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DeleteLogGroup",
          "logs:DeleteLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/*"
      },
      
      # SQS permissions for Serverless Framework
      {
        Effect   = "Allow"
        Action   = [
          "sqs:CreateQueue",
          "sqs:DeleteQueue",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ListQueues",
          "sqs:SetQueueAttributes"
        ]
        Resource = "arn:aws:sqs:${var.aws_region}:*:*"
      },
      
      # Route53 permissions (if needed for custom domains)
      {
        Effect   = "Allow"
        Action   = [
          "route53:ChangeResourceRecordSets",
          "route53:ListHostedZones",
          "route53:ListResourceRecordSets"
        ]
        Resource = "*"
      },
      
      # DynamoDB permissions for application
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:CreateTable",
          "dynamodb:DescribeTable",
          "dynamodb:DeleteTable",
          "dynamodb:UpdateTable",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/zipcase-*"
      },
      
      # Cognito permissions for user pool management
      {
        Effect   = "Allow"
        Action   = [
          "cognito-idp:CreateUserPool",
          "cognito-idp:DeleteUserPool",
          "cognito-idp:DescribeUserPool",
          "cognito-idp:UpdateUserPool",
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:UpdateUserPoolClient"
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:*:userpool/*"
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
8. Add these as secrets in your GitHub repository:
   - AWS_ACCESS_KEY_ID_DEV or AWS_ACCESS_KEY_ID_PROD (depending on environment)
   - AWS_SECRET_ACCESS_KEY_DEV or AWS_SECRET_ACCESS_KEY_PROD

===========================================================================
EOT
}