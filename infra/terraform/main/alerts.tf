# Alerting configuration resources

# SSM Parameter for alert email address
resource "aws_ssm_parameter" "alert_email" {
  name        = "/zipcase/alert-email"
  type        = "String"
  value       = var.alert_email
  description = "Email address for ZipCase alerts"
}
