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

## MANDATORY CHECK LIST
1. Any object projected to exceed 250k records explicitly classified as LDV — documented in data model
2. All SOQL on LDV objects uses at least one selective, indexed filter (indexed field with ≤ 10% result selectivity)
3. Custom indexes requested for every non-standard field used in WHERE clauses on LDV objects
4. Skinny tables evaluated for LDV objects used in high-frequency reports or list views
5. No synchronous SOQL query against an LDV object from a UI-blocking (VF/LWC controller) context
6. Archival strategy defined — Big Objects or external archival for records beyond the retention threshold
7. Batch Apex on LDV objects uses scope ≤ 200 and has been tested with a production-representative data volume
8. Reports and dashboards on LDV objects filtered to prevent full-table scans — no unfiltered report on an LDV object
9. COUNT() queries on LDV objects avoided unless a selective filter is present
10. Cross-object relationship traversal (parent→child queries) on LDV objects reviewed for query selectivity

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Non-selective SOQL on an object with >1M records — query times out in production, causing transaction failure and data not saved; Unfiltered Report or List View on LDV object — platform auto-disables the view, causing a user-facing outage |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | No archival strategy — unbounded record growth causes progressive query degradation across every query on the object; Synchronous SOQL against LDV object in a UI context — page load times degrade to 10s+ as data grows |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | No skinny table on a high-frequency-report LDV object — report run times approach the timeout ceiling and degrade user experience; Batch scope set to 2000 on an LDV object — heap governor limit breach under real data volumes |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | LDV object not classified in data model documentation — future architects write uninformed queries without selectivity awareness; COUNT() without a selective filter used in a monitoring script — returns instantly in sandbox, degrades progressively in production |
