locals {
  # Define API domains
  api_domains = {
    "api" = var.environment == "prod" ? "api.${var.domain}" : "api-dev.${var.domain}",
    "app-api" = var.environment == "prod" ? "app-api.${var.domain}" : "app-api-dev.${var.domain}"
  }

  # Map service names to their domain names
  api_service_to_domain = {
    "api" = var.environment == "prod" ? "api" : "api-dev",
    "app-api" = var.environment == "prod" ? "app-api" : "app-api-dev"
  }
}

# Create Route53 zones for each API domain
resource "aws_route53_zone" "api_zones" {
  for_each = local.api_service_to_domain
  name = "${each.value}.${var.domain}"
}

# Create certificate for all API domains
resource "aws_acm_certificate" "api_cert" {
  domain_name = values(local.api_domains)[0]
  subject_alternative_names = [for domain in values(local.api_domains) : domain if domain != values(local.api_domains)[0]]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Create DNS validation records for the API certificate
resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api_cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
      domain = replace(dvo.domain_name, ".${var.domain}", "")
    }
  }

  # Find correct zone for each validation record
  zone_id = aws_route53_zone.api_zones[
    contains(["api", "api-dev"], each.value.domain) ? "api" : "app-api"
  ].zone_id

  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

# Create DNS records for each API gateway
resource "aws_route53_record" "api_gateway_records" {
  for_each = local.api_service_to_domain

  zone_id = aws_route53_zone.api_zones[each.key].zone_id
  name    = "${each.value}.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.api_gateway_domains[each.key].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api_gateway_domains[each.key].regional_zone_id
    evaluate_target_health = false
  }
}