locals {
  subdomains = toset(["api", "app"])
}

resource "aws_route53_zone" "subdomain_zones" {
  for_each = local.subdomains
  name = "${each.value}${var.subdomain_suffix}.${var.domain}"
}

# resource "aws_ssm_parameter" "zipcase_hosted_zone_ids" {
#   for_each = local.subdomains
#   name  = "/zipcase/route53/${each.key}/hosted_zone_id"
#   type  = "String"
#   value = aws_route53_zone.subdomain_zones[each.key].zone_id
# }

resource "aws_acm_certificate" "zipcase_cert" {
    domain_name               = "app${var.subdomain_suffix}.${var.domain}"
    subject_alternative_names = ["api${var.subdomain_suffix}.${var.domain}"]
    validation_method         = "DNS"
}

resource "aws_route53_record" "zipcase_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.zipcase_cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = strcontains(each.value.name,".app") ? aws_route53_zone.subdomain_zones["app"].zone_id : aws_route53_zone.subdomain_zones["api"].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_route53_record" "apigateway_alias_records" {
  for_each = local.subdomains

  zone_id = aws_route53_zone.subdomain_zones["${each.key}"].zone_id
  name    = "${each.key}${var.subdomain_suffix}.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.api_gateway_domains["${each.key}${var.subdomain_suffix}"].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api_gateway_domains["${each.key}${var.subdomain_suffix}"].regional_zone_id
    evaluate_target_health = false
  }
}