# Security Model Patterns

## Guest User
- Never grant Create/Edit on sensitive objects to Guest User profile
- Tokenised URL pattern for unauthenticated writes
- FLS alignment — Guest User sees only necessary fields

## Field Level Security
- PII fields — restricted to minimum necessary profiles
- Encryption — Shield Platform Encryption for regulated data
- No application-layer encryption on Shield-managed fields (double encryption risk)

## Sharing Model
- Private OWD default for sensitive objects
- Explicit sharing rules — no reliance on role hierarchy alone
- Apex managed sharing — document and audit

## Compliance
- APRA CPS 234 — encryption at rest and in transit
- Australian Privacy Act — PII field identification and protection
- Audit trail — History Tracking limits (20 fields per object)

## Relevant Agents
- sf-data, sf-lwc, sf-apex, sf-integration
