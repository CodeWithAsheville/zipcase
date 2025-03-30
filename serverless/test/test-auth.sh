#!/bin/bash

# Script to run the Portal authentication integration test
# Usage: ./test-auth.sh username password

if [ $# -lt 2 ]; then
  echo "Usage: ./test-auth.sh username password"
  exit 1
fi

# Set environment variables and run the test
USERNAME="$1" PASSWORD="$2" npm run test:auth