resource "aws_cognito_user_pool" "zipcase_user_pool" {
  name = "zipcase-user-pool"

  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = false
    require_uppercase = false
    require_numbers   = false
    require_symbols   = false
  }

  username_attributes = ["email"]
}

resource "aws_ssm_parameter" "zipcase_user_pool_id" {
  name  = "/zipcase/cognito/user_pool_id"
  type  = "String"
  value = aws_cognito_user_pool.zipcase_user_pool.id
}

resource "aws_cognito_user_pool_client" "zipcase_app_client" {
  name = "zipcase-app-client"
  user_pool_id = aws_cognito_user_pool.zipcase_user_pool.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  generate_secret = false
}

resource "aws_ssm_parameter" "zipcase_app_client_id" {
  name  = "/zipcase/cognito/app_client_id"
  type  = "String"
  value = aws_cognito_user_pool_client.zipcase_app_client.id
}

