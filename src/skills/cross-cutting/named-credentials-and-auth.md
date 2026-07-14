# Named Credentials & Authentication Patterns

## Core Rule
All external endpoint URLs, tokens, usernames, and passwords must be stored in Named Credentials. Hardcoded endpoints in Apex are a mandatory Must-Fix — they are a security violation and break deployment portability.

## Named Credentials
- Use Named Credentials for all HTTP callouts — callout:My_Named_Credential/path
- Never hardcode endpoint URLs, auth tokens, or API keys in Apex code
- Per-user vs org-wide Named Credentials — choose based on data access model
- External Credentials (OAuth 2.0, JWT, custom) — use for modern API auth flows
- Named Principal vs Per-User Principal — understand sharing implications

## OAuth Patterns
- OAuth 2.0 Client Credentials — for server-to-server integrations
- OAuth 2.0 JWT Bearer — for certificate-based auth
- Never store client_secret in custom settings or custom metadata unencrypted
- Token refresh handling — Named Credentials manage this automatically

## Common Anti-patterns
- Hardcoded endpoint URL in HttpRequest.setEndpoint()
- API key in custom settings readable by all admins
- Basic auth credentials in Apex string literals
- Self-signed certificates in production without proper CA chain

## Deployment Considerations
- Named Credentials are org-specific — must be recreated per environment
- Use Named Credential substitution in CI/CD pipelines
- Document all external dependencies in deployment runbook

## Relevant Agents
- sf-apex, sf-integration, sf-patterns

## MANDATORY CHECK LIST
1. All `HttpRequest.setEndpoint()` calls use `callout:Named_Credential_Name/path` syntax — no hardcoded URLs
2. No auth tokens, API keys, or passwords in Apex string literals, constants, or static variables
3. No credentials stored in unencrypted text fields in Custom Settings or Custom Metadata records
4. OAuth 2.0 flow selection matches the use case — Client Credentials for server-to-server, JWT Bearer for certificate-based auth
5. Per-user vs org-wide Named Credential selection documented and justified based on the data access model
6. Token refresh handling delegated to the Named Credential — not implemented manually in Apex code
7. No self-signed certificates used in production — proper CA-signed certificate chain required
8. Named Credential recreation steps documented in the deployment runbook for every target environment
9. External Credentials used for modern OAuth 2.0 flows — not legacy Named Credentials with embedded basic auth
10. No `client_secret` stored in plaintext in any configuration record, Custom Metadata, or Custom Setting
11. Named Credential substitution configured in the CI/CD pipeline for sandbox, UAT, and production environments
12. All external endpoint dependencies inventoried — no undocumented third-party callout targets

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Hardcoded endpoint URL or API key in Apex source code — credential exposed in version control and breaks on every environment promotion; `client_secret` stored in an unencrypted Custom Setting — any admin with CRUD on the object can read the secret |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | No Named Credential — integration requires manual credential rotation in Apex code, creating deployment risk and a recurring security exposure; Per-user Named Credential used for an org-wide service account — integration fails for all users when one user's token expires |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Self-signed certificate in production — breaks unexpectedly when the certificate expires or when CA chain validation is enforced by the downstream; No deployment runbook entry for Named Credentials — environment promotion requires undocumented manual steps that are frequently missed |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Legacy Named Credential used where External Credential is the correct modern pattern — will require migration as Salesforce deprecates older authentication flows; External endpoint dependencies not inventoried — security review cannot assess the full integration attack surface |
