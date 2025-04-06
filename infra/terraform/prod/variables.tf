variable "domain" {
    default     = "zipcase.org"
}

variable "environment" {
    default     = "prod"
}

variable "region" {
    default     = "us-east-2"
}

variable "alert_email" {
    description = "Email address for alerts"
    type        = string
}
