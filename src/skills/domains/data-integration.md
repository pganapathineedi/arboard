# Data & Integration Specialist — Review Checklist

## Data Model
- Relationship types — master-detail vs lookup implications
- Cardinality — junction object correct usage
- Custom vs standard object selection

## SOQL
- Non-selective filters — no index on WHERE clause
- SELECT * anti-pattern
- Missing LIMIT on unbounded queries
- Query inside loop

## Sharing Model
- OWD — most restrictive appropriate setting
- Sharing rules — criteria vs owner based
- Role hierarchy alignment with access model
- With Sharing / Without Sharing violations

## Integration Patterns
- Idempotency — duplicate message handling
- Error retry — exponential backoff
- REST vs SOAP vs Platform Events — correct selection
- Outbound Message vs CDC vs Platform Events tradeoffs

## Data Migration
- Null handling strategy
- Duplicate rule conflicts
- Rollback strategy undefined

## MANDATORY CHECK LIST
1. FLS enforced on all SOQL — `WITH SECURITY_ENFORCED` or `Security.stripInaccessible()` used on every query
2. All Apex classes explicitly declare `with sharing` or `without sharing` — no implicit (default = without sharing) class
3. LDV objects projected to exceed 250k records have custom indexes on every field used in WHERE clauses
4. External ID fields used for all upsert operations — no environment-specific record IDs in integration payloads
5. API version pinned in all integration endpoint metadata — not using a versionless or floating "latest" endpoint
6. All PII fields identified and Australian Privacy Act obligations documented per field
7. Explicit field list used in all SOQL — no SELECT * or dynamic query pulling all fields
8. No SOQL or DML inside for/while loops in integration classes
9. Idempotency keys implemented — duplicate inbound messages produce no duplicate records
10. Integration error retry strategy defined with a documented maximum attempt limit
11. Null handling strategy documented and tested for all inbound data fields
12. Sharing model (OWD + sharing rules) verified for every object exposed via integration

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | FLS not enforced in SOQL — a low-privilege or guest user can read restricted PII fields via Apex (Privacy Act violation); No External ID on upsert — integration creates duplicate records on every deployment to a new environment |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | LDV object with no custom index — SOQL becomes non-selective, queries time out progressively as record count grows; `without sharing` on an Apex class exposed to community users — entire sharing model bypassed, all records visible |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | API version not pinned — integration breaks silently when Salesforce retires the previously used endpoint version; Dynamic SOQL using SELECT * — fragile, fetches unnecessary data, breaks on field-permission changes |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Null handling undocumented — intermittent DML errors surface when upstream system sends unexpected null values; Rollback strategy undefined for multi-step migration — partial completion leaves data in an indeterminate state |
