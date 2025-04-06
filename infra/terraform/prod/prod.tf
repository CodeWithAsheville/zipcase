module "main" {
  source           = "../main"
  environment      = var.environment
  region           = var.region
  domain           = var.domain
  alert_email      = var.alert_email
}
