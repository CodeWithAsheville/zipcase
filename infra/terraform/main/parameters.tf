resource "aws_ssm_parameter" "waf_solver_api_key" {
  name  = "/zipcase/waf-solver/api-key"
  type  = "SecureString"
  value = var.capsolver_api_key
}
