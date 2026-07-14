# OmniStudio Specialist — Review Checklist

## OmniScript
- Step structure — branching logic complexity
- Conditional visibility — performance impact
- Remote action vs DataRaptor — correct selection

## DataRaptor
- Extract vs Transform vs Load — correct usage
- JSON path correctness
- Over-fetching — pulling unnecessary fields

## Integration Procedures
- Error handling — missing HTTP error checks
- No retry logic on external callouts
- Response transformation complexity

## FlexCard
- Nested DataRaptor anti-patterns
- Over-fetching data sources
- State management — card vs child card data flow

## Deployment
- Native vs managed package decisions
- LWC OmniStudio migration readiness
- Deprecated Aura OmniStudio components

## MANDATORY CHECK LIST
1. Every Integration Procedure HTTP action checks the response HTTP status code and branches explicitly on error
2. Integration Procedures have a timeout value configured — not relying on the Salesforce platform default indefinitely
3. DataRaptor Extract maps only the fields required by the consuming OmniScript step or FlexCard — no over-fetching
4. DataRaptor field path JSON expressions validated against actual object and field API names
5. OmniScript steps validate required user inputs before invoking Integration Procedures
6. FlexCards use action card caching where data does not change per page load
7. Managed package vs unmanaged deployment decision documented and applied consistently across all environments
8. All deprecated Aura OmniStudio components identified and flagged for LWC migration
9. Integration Procedure retry logic present for transient external callout failures
10. OmniScript branching conditions handle null and empty inputs — no silent path skip on missing data
11. DataRaptor Load operations use External ID for upsert — never environment-specific record IDs
12. FlexCard child card data passed via input parameters — not re-fetched independently per child card

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Integration Procedure callout has no error handling — HTTP 500 from external system causes silent data loss with no alert; DataRaptor Load upsert keyed on record ID instead of External ID — corrupts or duplicates data on every environment promotion |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | OmniScript step has no input validation — malformed data submitted to Integration Procedure causes downstream system failures; Integration Procedure has no timeout — hung external callout blocks the OmniScript UI session indefinitely |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | DataRaptor Extract fetches 30 fields when 5 are displayed — unnecessary data transfer and fragile field-permission coupling; FlexCard re-fetches its data source on every render with no caching — poor performance as concurrent user count grows |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Deprecated Aura OmniStudio component still in use — will break on a future managed package upgrade without warning; DataRaptor naming convention not followed — mapping coverage is impossible to audit across the org |
