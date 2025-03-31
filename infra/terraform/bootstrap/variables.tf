variable "aws_region" {
  description = "The AWS region to deploy resources to"
  type        = string
  default     = "us-east-2"
}

variable "aws_profile" {
  description = "The AWS CLI profile to use for authentication"
  type        = string
}