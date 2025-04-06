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

variable "alert_email" {
  description = "Email address for alerts"
  type        = string
  sensitive   = true
}

