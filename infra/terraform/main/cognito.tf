resource "aws_cognito_user_pool" "zipcase_user_pool" {
  name = "zipcase-user-pool"

  auto_verified_attributes = ["email"]

  # Customize emails for when an admin creates a user
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Welcome to ZipCase - Your Temporary Password"
      email_message = <<EOT
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 20px;">
    <img src="https://${var.environment == "prod" ? "app" : "app-dev"}.zipcase.org/ZipCaseLogo.png" alt="ZipCase Logo" style="max-width: 200px; height: auto;">
  </div>

  <p>Welcome to ZipCase! Your account has been created. Please use the following temporary password to sign in:</p>

  <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
    <p><strong>Username:</strong> {username}</p>
    <p><strong>Temporary Password:</strong> {####}</p>
  </div>

  <p>After you sign in, you will be prompted to create a new password.</p>

  <p>Sign in to ZipCase at: ${var.environment == "prod" ? "https://app.zipcase.org" : "https://app-dev.zipcase.org"}</p>
</div>
EOT
      sms_message   = "Your ZipCase username is {username} and temporary password is {####}. Access ZipCase at: ${var.environment == "prod" ? "https://app.zipcase.org" : "https://app-dev.zipcase.org"}"
    }
  }

  # Configure password reset messaging
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Reset Your ZipCase Password"
    email_message        = <<EOT
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 20px;">
    <img src="https://${var.environment == "prod" ? "app" : "app-dev"}.zipcase.org/ZipCaseLogo.png" alt="ZipCase Logo" style="max-width: 200px; height: auto;">
  </div>

  <p>You have requested to reset your ZipCase password. Please use the following code to complete the process:</p>

  <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0; text-align: center; font-size: 20px; letter-spacing: 5px;">
    <strong>{####}</strong>
  </div>

  <p>If you did not request this password reset, please ignore this email.</p>

  <p>Sign in to ZipCase at: ${var.environment == "prod" ? "https://app.zipcase.org" : "https://app-dev.zipcase.org"}</p>
</div>
EOT
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
  name         = "zipcase-app-client"
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
