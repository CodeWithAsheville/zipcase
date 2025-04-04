resource "aws_s3_bucket" "terraform_state" {
  bucket = "zipcase-tf-state-${var.environment}"
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state_versioning" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status     = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "terraform_state_lifecycle" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "retain-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Serverless Framework deployment bucket
resource "aws_s3_bucket" "serverless_deployments" {
  bucket = "zipcase-serverless-deployments-${var.environment}"
}

resource "aws_s3_bucket_ownership_controls" "serverless_deployments" {
  bucket = aws_s3_bucket.serverless_deployments.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "serverless_deployments_versioning" {
  bucket = aws_s3_bucket.serverless_deployments.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "serverless_deployments_encryption" {
  bucket = aws_s3_bucket.serverless_deployments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "serverless_deployments_lifecycle" {
  bucket = aws_s3_bucket.serverless_deployments.id

  rule {
    id     = "cleanup-old-versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    expiration {
      days = 90
    }
  }
}
