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

## MANDATORY CHECK LIST
1. Guest User profile has no Create/Edit permission on any object containing PII or financial data
2. All SOQL in Apex enforces FLS — `WITH SECURITY_ENFORCED` or `Security.stripInaccessible()` on every query
3. All Apex classes explicitly declare `with sharing` — no class relies on the implicit without-sharing default
4. Shield Platform Encryption enabled for all PII fields subject to the Australian Privacy Act
5. No application-layer encryption applied on top of Shield-managed fields — double encryption risk
6. Sharing model documented per object — OWD setting, explicit sharing rules, and role hierarchy intent all recorded
7. Apex managed sharing documented and audited — every custom share record has a clear owning process
8. Field History Tracking enabled on all PII and audit-critical fields — 20-field-per-object limit verified
9. Tokenised URL pattern used for any Guest User unauthenticated write path — no direct record ID in URL
10. APRA CPS 234 encryption requirements verified — encryption at rest and in transit for all regulated data stores
11. No `client_secret`, API key, or auth token stored in unencrypted Custom Settings or Custom Metadata text fields
12. Experience Cloud / community pages expose only fields the Guest User profile has explicit FLS read access to

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Guest User profile has Edit permission on Account or Contact — any unauthenticated user can corrupt CRM data (data breach and Privacy Act violation); PII field unencrypted in a regulated context — APRA CPS 234 / Australian Privacy Act non-compliance |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Apex class defaults to `without sharing` — all SOQL bypasses the sharing model, exposing records across all user contexts; FLS not enforced in SOQL — a low-privilege user reads restricted or encrypted field values via Apex |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Apex managed sharing not documented — future admins create conflicting sharing rules, causing undetected access regression; History Tracking not enabled on PII fields — compliance audit trail is incomplete and cannot satisfy regulatory requests |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Role hierarchy relied upon as the sole access control without explicit sharing rules — fragile as org structure changes; OWD not set to the most-restrictive appropriate default — access control relies on profile configuration alone |
