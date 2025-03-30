# Integration Tests

This directory contains integration tests that interact with real external services.

## Portal Authentication Tests

The portal authentication tests in `portalAuthenticator.test.ts` test the actual authentication flow against the court portal using the PortalAuthenticator module.

### Prerequisites

These tests require:
- Valid court portal credentials
- Network access to the court portal

### Running the Tests

There are multiple ways to run the integration tests:

#### Using the test-auth.sh script (recommended)

```bash
./test-auth.sh your_username your_password
```

#### Using npm directly

```bash
USERNAME=your_username PASSWORD=your_password npm run test:auth
```

#### Running all integration tests

```bash
USERNAME=your_username PASSWORD=your_password npm run test:integration
```

### Test Details

The tests verify:
1. Successful authentication with valid credentials
2. Session token verification
3. Failed authentication with invalid credentials

### Security Notes

- Never commit real credentials to the repository
- The integration tests are skipped if no credentials are provided
- Consider using a dedicated test account for these tests