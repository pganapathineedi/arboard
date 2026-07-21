# OmniStudio Specialist — Review Checklist

## OmniScript design patterns and performance
- Steps with external data calls using DataRaptor Remote (HTTP) instead of Integration Procedure — DataRaptor is for SOQL/DML only, not callouts
- Full OmniScript context object passed to sub-OmniScripts instead of only the required fields — large payload bloats session memory and sub-script compilation
- Conditional visibility not used — all elements rendered on every step load regardless of user path, increases LWC bundle parse time
- No step-level error handling on Remote Actions or Integration Procedure calls — errors propagate to top level with no user-facing message
- OmniScript used for server-side automation without a UI — Integration Procedure is the correct tool for headless orchestration
- Multi-session flow (resume scenario) with no data persistence strategy — user loses state on browser close or session timeout
- Single OmniScript shared across web, mobile, and agent desktop channels with no branching — one channel's requirement change breaks all others
- Script LWC compilation bundle size not reviewed — complex scripts with >100 elements produce oversized JS payloads affecting cold-load performance

## FlexCard data source architecture
- FlexCard data source firing unbounded SOQL with no field restriction — equivalent to SELECT * on potentially large result sets
- Child card actions firing one query per parent record in a list (N+1 query pattern) — 200 visible parent records = 200 child data source calls
- Data source using DataRaptor Extract for multi-object assembly requiring joins or conditional logic — Integration Procedure handles this; DataRaptor does not
- No record limit or pagination on FlexCard list view — unbounded record set returned at render time
- Flyout or action panel making a live callout on every open without caching — repeated external calls on hover/click under concurrent user load
- FlexCard state not persisted between navigation events — user loses unsaved selections; no design for state restoration

## DataRaptor anti-patterns
- DataRaptor Extract used for HTTP callouts — DataRaptor supports SOQL/DML only; callouts belong in Integration Procedure HTTP Actions
- DataRaptor Transform used to apply conditional business logic — transforms are for structural data shaping; conditions and branching belong in Integration Procedure Decision elements
- DataRaptor Load performing DML without bulk consideration — no review of concurrent load impact or batch size
- DataRaptor field mappings using hardcoded namespace prefixes — works in the development org, breaks on deployment to a managed package org with a different namespace
- No error handling on DataRaptor Load — partial DML failures silently drop records with no error surface in the calling OmniScript
- DataRaptor Extract queries on LDV objects with non-indexed filters — non-selective queries cause timeout at production data volumes (see sf-data guidance)

## Integration Procedure orchestration and error handling
- HTTP Action steps with no timeout configured — external system latency blocks the entire Integration Procedure execution indefinitely
- No error handling on HTTP Action steps — non-200 responses return an empty response node; downstream Set Values steps receive null and throw NPE
- Integration Procedure calling Integration Procedure in a synchronous chain more than 5 levels deep — timeout budget consumed cumulatively; innermost IP times out first, cascading failures upstream
- No retry logic on transient HTTP failures — a single 429 or 503 aborts the procedure with no recovery
- Response structure from HTTP Action assumed without null-checking — downstream steps reference nested keys that are absent on error responses
- Using Integration Procedure for simple single-object SOQL retrieval where DataRaptor Extract suffices — over-engineering adds latency and complexity

## Callable Apex patterns
- `call()` method signature does not match `System.Callable` interface — `(String action, Map<String, Object> args)` must be exact; any deviation causes a runtime cast exception
- Callable Apex throwing an unhandled exception — OmniStudio framework receives a null output map; the calling OmniScript element fails silently with no error propagation
- Input `args` map mutated directly instead of copying values to a new output map — mutations to the input parameter cause unpredictable side-effects when the same map is referenced by other steps
- No null-check on the `args` parameter or expected keys — NPE when optional parameters are not passed from OmniScript
- DML inside a loop within Callable Apex — OmniStudio does not enforce separate governor limit budgets; Apex limits apply normally
- Callable Apex not reviewed for FLS — OmniStudio framework does not enforce field-level security on Callable Apex output; data returned is visible to all OmniScript users regardless of profile

## Namespace considerations for managed vs unmanaged packages
- OmniScript and DataRaptor metadata created in unmanaged form when the deployment target is a managed package org — API names collide with package namespace at deployment
- Namespace prefix hardcoded in DataRaptor field mappings, OmniScript element JSON, or Integration Procedure property keys — works in source org, fails in any org with a different namespace configuration
- EPC product attributes referencing managed package field API names directly in custom DataRaptors — upstream package upgrade changes field names; DataRaptor silently returns null
- No namespace strategy documented in the SDD — managed vs unmanaged package decision deferred to implementation; discovered at deployment
- DataPack export/import used for metadata migration without verifying namespace resolution in the target org

## Vlocity/Industries migration patterns
- Vlocity metadata migrated to OmniStudio without element compatibility assessment — several Vlocity OmniScript element types do not exist in OmniStudio; scripts partially render then fail at the incompatible step
- DataPack deployed to a new org without confirming all dependent managed package components are present in the target
- EPC model ported directly from Vlocity product structure to Industries Cloud without redesigning for the Industries data model — attribute inheritance and product relationship models differ between platforms
- No rollback plan documented for Vlocity → OmniStudio migration — failed migration leaves org in a partially migrated state
- Testing plan covers only happy path — Vlocity migration regressions appear on edge-case data combinations not exercised in UAT

## EPC product catalog modeling
- Product hierarchy more than 4 levels deep — configuration page load time grows non-linearly with hierarchy depth; beyond 4 levels, page load times regularly exceed 5 seconds
- Product attributes using free-text fields where picklist values are required — unconstrained input creates downstream data quality issues in order management and billing
- No attribute inheritance strategy — child products duplicate parent attributes rather than inheriting; catalog maintenance burden grows with every new product variant
- Product bundles and packages not tested with the full catalog loaded — eligibility rules and incompatibility constraints that work with 10 products fail at 500 due to rule evaluation time
- CME (Custom Metadata Entity) structures not reviewed for query performance at catalog scale — unindexed attribute queries on large catalogs cause timeout in the configurator

## Common failure modes in SI delivery
1. **DataRaptor Extract fires per FlexCard row** — list card renders 300 rows; each fires its own SOQL Extract; 300 concurrent queries; governor limit hit; all cards blank with no error message
2. **Integration Procedure HTTP Action has no timeout** — third-party API degrades at peak; every IP call hangs indefinitely; OmniScript sessions pile up; org performance degrades globally
3. **Callable Apex throws unhandled exception** — OmniScript receives null output map; downstream Set Values step throws NPE; entire script fails with a generic error; no stack trace surfaced to the user
4. **Namespace prefix hardcoded in DataRaptor** — field mapping `vlocity_cmt__ProductId__c` hardcoded; deployment to production managed package org fails; field not found at runtime; discovered the day before go-live
5. **OmniScript shared across web and agent channels** — agent desktop requires a confirmation step; added directly to the shared script; web channel now shows an irrelevant confirmation; both channels broken by the same change
6. **EPC hierarchy 6 levels deep** — product configuration page load measured at 9 seconds under full catalog; abandoned rate 60%; issue traced to recursive attribute query across 6 hierarchy levels
7. **Integration Procedure chain 7 levels deep** — outermost IP has a 30-second timeout; innermost IP times out first; timeout cascades up; all 7 IPs fail; no intermediate state preserved; user sees a generic error
8. **Vlocity element migration gap** — `SetErrors` element from Vlocity OmniScript not available in OmniStudio; migrated script fails at that step; regression only found in production because test scripts used a happy path that never reached the error branch

## MANDATORY CHECK LIST
1. All OmniScript steps making external calls use Integration Procedures — DataRaptor Remote is not used for HTTP callouts
2. Integration Procedure HTTP Action steps have an explicit timeout configured
3. IP error handling is present on all HTTP Action steps — non-200 responses are mapped to an error output key, not silently swallowed
4. FlexCard list views have a record limit or pagination — unbounded data source results not acceptable
5. Callable Apex implements `System.Callable` correctly — `call()` signature matches the interface, output map always returned, all exceptions caught and returned in output
6. No namespace prefixes hardcoded in DataRaptor field mappings, OmniScript element JSON, or Integration Procedure property keys
7. OmniScript step-level error handling present on every Remote Action and IP call step — user-facing error message defined
8. EPC product hierarchy depth reviewed — maximum 4 levels without documented performance justification and load test evidence
9. FlexCard child data source pattern reviewed for N+1 — parent and child data loaded in a single Integration Procedure call where possible
10. Vlocity → OmniStudio migration includes element compatibility inventory — every element type in migrated scripts verified against OmniStudio support matrix
11. OmniScript channel strategy documented — dedicated script per channel or explicit branching logic if shared; changes to shared scripts require cross-channel regression test
12. Callable Apex FLS reviewed — output map fields verified against the minimum FLS required for the calling user's profile

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Security breach, data exposure, or compliance violation. Block go-live. | Callable Apex returning PII or financial fields without FLS check — OmniStudio framework does not enforce field security on Callable Apex output; all calling users receive the data regardless of profile; Callable Apex unhandled exception exposing internal stack trace to the OmniScript UI layer |
| HIGH | Reliability failure or performance degradation that will surface at production scale. | Integration Procedure HTTP Action with no timeout — external API degradation hangs all in-flight OmniScript sessions indefinitely; FlexCard list view firing one DataRaptor Extract per row (N+1) on a 300-record list — governor limit hit, all cards fail silently; Callable Apex throwing unhandled exception — OmniScript receives null output, downstream steps NPE, script fails with no user message |
| MEDIUM | Technical debt or fragility that compounds as the implementation grows. Fix within current release. | Namespace prefix hardcoded in DataRaptor field mappings — deployment to managed package org fails; EPC product hierarchy >4 levels — progressive load time degradation as catalog grows; Integration Procedure chain >5 levels — timeout cascade risk under load; OmniScript shared across channels with no branching — single change breaks all channels |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | DataRaptor used where Integration Procedure would be cleaner — no runtime impact today, technical debt as complexity grows; OmniScript naming convention not followed — metadata discovery difficult during incident response; FlexCard flyout making live callout on every open without a cache TTL — inefficient but not a failure |
