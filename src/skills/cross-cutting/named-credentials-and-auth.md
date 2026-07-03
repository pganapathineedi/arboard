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
