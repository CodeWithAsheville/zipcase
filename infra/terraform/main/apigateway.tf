resource "aws_api_gateway_domain_name" "api_gateway_domains" {
  depends_on               = [aws_route53_record.api_cert_validation]
  for_each                 = local.api_service_to_domain
  domain_name              = "${each.value}.${var.domain}"
  regional_certificate_arn = aws_acm_certificate.api_cert.arn

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}
