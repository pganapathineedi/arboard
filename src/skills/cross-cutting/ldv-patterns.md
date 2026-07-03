# Large Data Volume Patterns

## Risk Indicators
- Objects projected to exceed 1M records
- Reports/dashboards on high-volume objects without filters
- SOQL without selective index filters on large objects

## Mitigation Patterns
- Custom indexes on frequently queried fields
- Skinny tables for high-volume reporting
- Archival strategy — Big Objects, external archival
- Async processing — no synchronous queries on LDV objects

## Relevant Agents
- sf-data, sf-patterns, sf-apex
