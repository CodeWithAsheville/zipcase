variable "aws_profile" {
  description = "AWS profile defined in ~/.aws/credentials"
  type        = string
}

variable "use_profile" {
  description = "Whether to use AWS profile (local) or credentials (CI/CD)"
  type        = bool
  default     = true
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev/prod)"
  type        = string
}

variable "region" {
  description = "AWS region into which to deploy resources"
  type        = string
}

variable "subdomain_suffix" {
  description = "Subdomain suffix for the environment ('-dev')"
  type        = string
}