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
