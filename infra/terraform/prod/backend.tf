terraform {
  backend "s3" {
    bucket         = "zipcase-tf-state-prod"
    key            = "terraform.tfstate"
    region         = "us-east-2"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}
