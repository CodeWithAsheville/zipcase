locals {
  subdomains_with_suffixes = toset(["app${var.subdomain_suffix}", "api${var.subdomain_suffix}"])
}

resource "aws_api_gateway_domain_name" "api_gateway_domains" {
  depends_on               = [aws_route53_record.zipcase_cert_validation]
  for_each                 = local.subdomains_with_suffixes
  domain_name              = "${each.key}.${var.domain}"
  regional_certificate_arn = aws_acm_certificate.zipcase_cert.arn

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}
