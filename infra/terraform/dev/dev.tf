module "main" {
  source           = "../main"
  environment      = var.environment
  region           = var.region
  domain           = var.domain
  subdomain_suffix = var.subdomain_suffix
}
