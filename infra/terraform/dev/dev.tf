module "main" {
  source      = "../main"
  aws_profile = var.aws_profile
  environment = var.environment
  region = var.region
  domain = var.domain
  subdomain_suffix = var.subdomain_suffix
}
