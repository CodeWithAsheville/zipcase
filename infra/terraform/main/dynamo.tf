resource "aws_dynamodb_table" "terraform_state_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  deletion_protection_enabled = true

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = "Terraform State Lock Table"
    Environment = var.environment
  }
}

# DynamoDB table for error cache and deduplication
resource "aws_dynamodb_table" "error_cache" {
  name         = "zipcase-error-cache-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "errorKey"

  attribute {
    name = "errorKey"
    type = "S"
  }

  # Enable TTL for automatic cleanup
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "ZipCase Error Cache Table"
    Environment = var.environment
    Service     = "AlertService"
  }
}