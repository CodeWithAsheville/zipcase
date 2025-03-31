variable "aws_profile" {
    default     = "zipcase-dev"
    description = "AWS profile to use for local development"
}

variable "use_profile" {
    default     = true
    description = "Whether to use AWS profile (local) or credentials (CI/CD)"
    type        = bool
}

variable "domain" {
    default     = "zipcase.org"
}

variable "environment" {
    default     = "dev"
}

variable "region" {
    default     = "us-east-2"
}

variable "subdomain_suffix" {
    default     = "-dev"
}