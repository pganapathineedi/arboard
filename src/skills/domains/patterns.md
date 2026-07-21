# SI Failure Patterns — Cross-Domain Review Checklist

## Purpose & Scope

This skill file grounds the sf-patterns agent in the most common SI delivery failure patterns observed across Salesforce implementations. It covers cross-domain risks that span multiple technology layers (Apex, Flow, Integration, Data, Security) and are frequently missed when each domain is reviewed in isolation.

The patterns agent is invoked when a document, SDD, or code review suggests cross-cutting concerns that no single domain agent can fully address — architecture smells, cross-automation conflicts, governance gaps, and delivery anti-patterns.

## SI Delivery Failure Pattern Taxonomy

**Category A — Integration & Async:**
Failures at the boundary between Salesforce and external systems, or within Salesforce's async processing layer, that cause silent data loss or uncatchable runtime errors.

**Category B — Data & Governor Limits:**
Failures rooted in data model choices or automation design that only become critical when data volumes exceed the development-phase scale.

**Category C — Automation Stack:**
Failures caused by multiple automation types (Trigger, Flow, Workflow, Process Builder) owning the same operation, or interacting in undefined order.

**Category D — Agentforce & AI:**
Failures in Agentforce agent design that expose PII, allow prompt injection, or produce unreliable agent behaviour due to over-broad topic scope or missing human escalation.

**Category E — Security & Compliance:**
Failures that pass internal QA but allow unauthorised data access, credential exposure, or audit gap under real-world conditions.

## Cross-Domain Failure Detection Approach

When reviewing an SDD, design document, or code package spanning multiple Salesforce domains, apply these cross-cutting checks before domain-specific reviews:

**1. Automation ownership map** — For every key object in scope, list all automations (Triggers, Flows, Process Builder, Workflow Rules) that fire on DML events. Identify any object where more than one automation type updates the same field or creates the same related record. Any overlap is a conflict requiring resolution.

**2. Governor limit stack** — Model the peak transaction for each key object: which trigger fires, how many SOQL queries it runs, how many DML statements, which flows also fire on the same event, how many subflows are called, whether any Apex actions or callouts are in the chain. Confirm total SOQL + DML + CPU stays within limits at 200-record bulk DML.

**3. Error path completeness** — Trace every DML operation, every async job, and every callout to its failure case. Confirm there is a visible error path (user message, log record, alerting event) for every failure mode. Any path that terminates silently is a production risk.

**4. Data volume stress test** — For every custom object in scope, confirm a year-3 volume projection exists. For any object projected above 500k records, confirm indexing and SOQL selectivity. For any append-only object (log, event, activity), confirm an archival strategy.

**5. Security boundary sweep** — For every Apex class reachable from an external user (AuraEnabled, RestResource, Invocable, Experience Cloud), confirm `with sharing` is declared and FLS is enforced. For every integration endpoint, confirm Named Credentials are used and the integration user has a scoped, non-admin profile.

## Category A — Integration & Async Failures

**FP-004 — Integration contracts undocumented:**
- Every external system integration must define: the API contract (OpenAPI spec or WSDL), the error handling strategy (retry, dead-letter, alerting), the data ownership (who is the system of record), and the integration owner (the team responsible when the integration breaks)
- An integration without a documented contract will break silently when the external API evolves — and it will evolve

**FP-005 — No retry / idempotency on outbound calls:**
- Every outbound write callout (POST, PUT, PATCH) must have an idempotency key and a retry mechanism
- A POST without an idempotency key creates a duplicate record in the external system on any network timeout retry
- Retry without idempotency is worse than no retry

**FP-006 — Silent failure in async:**
- Every `Queueable.execute()`, `Batch.execute()`, and Platform Event subscriber handler must have a try/catch with a persistent error log — not an empty catch block
- An unhandled exception in async context marks the job failed with no alert, no audit trail, and no retry — the operation is lost

**FP-009 — No dead-letter handling:**
- Failed async messages (Platform Events, Queueable results, batch errors) must route to a dead-letter object or queue with an operational alert
- An error that is caught but not persisted is indistinguishable from an error that never occurred — it cannot be replayed, triaged, or reported

## Category B — Data & Governor Limit Failures

**FP-011 — LDV object without indexing or archival:**
- Any custom object projected to exceed 1M records is an LDV object and requires an explicit indexing strategy (External ID, custom index request) and an archival strategy (Big Objects, native archival, external data lake)
- A design with no volume projection for a business-critical object is a design gap — volume must be documented at design time, not discovered in production

**FP-007 — Hardcoded environment config:**
- Org IDs, profile IDs, queue IDs, role IDs, user IDs, and endpoint URLs must never be hardcoded in Apex, Flow formulas, or metadata values
- Use Custom Metadata Type records keyed by DeveloperName for all environment-specific configuration; query by DeveloperName at runtime
- Hardcoded IDs are org-specific — they break silently on deployment to any other environment

**FP-008 — Missing rollback strategy for multi-step DML:**
- Any operation that executes DML across multiple steps or objects must document an explicit rollback or compensating transaction strategy
- Salesforce rolls back the current transaction on an exception — but partial commits across separate async transactions cannot be automatically rolled back
- Document whether the operation is all-or-nothing (single sync transaction) or has compensation logic for partial failure

**FP-012 — No data migration runbook:**
- Every data migration must document: rollback criteria (at what point is the migration aborted and the old system restored), cutover window (start time, end time, freeze period), source-to-target reconciliation count, and post-migration validation queries
- A migration without a rollback plan is a one-way gate — if something goes wrong after cutover, there is no documented path back

## Category C — Automation Stack Failures

**FP-010 — Mixed automation stack on the same object:**
- When Workflow Rules, Process Builder, and Flow all fire on the same object's DML event, their interactions are undefined from a business perspective — each automation is correct in isolation, but their combined effect on shared fields is unpredictable
- Audit every active automation type on every key object before adding new automation — document the inventory in an Automation Registry
- The migration path is: consolidate all logic onto record-triggered Flow; deactivate and delete legacy automations in the same release

**Automation conflict detection pattern:**
For every object in scope, query: active triggers, active record-triggered flows, active Process Builder processes, active Workflow Rules. Flag any object where more than one type performs a DML or field update on the same field. This is a guaranteed conflict.

## Category D — Agentforce & AI Failures

**FP-013 — Agentforce over-broad topic scope:**
- Each Agentforce topic must have a tightly scoped instruction set with defined boundaries — what the agent CAN and CANNOT do
- A topic instruction set that says "help users with anything sales-related" is too broad — the agent will attempt actions outside its intended scope, producing inconsistent results
- Maximum recommended: 5 actions per topic; additional scope splits into a separate topic with clear handoff intent

**FP-014 — Missing escalation path:**
- Every Agentforce agent must define a human-in-the-loop escalation path for requests it cannot resolve
- An agent without an escalation path leaves the user in a dead-end — they cannot get help from a human and cannot retry the request
- Escalation criteria must be explicit: unrecognised intent, action failure after retry, user explicitly requests human, regulated-data handling required

**FP-015 — Ungrounded agent actions exposing PII:**
- All Agentforce custom actions that access or return personal data must route data through the Einstein Trust Layer before injecting into an LLM prompt context
- PII (name, email, phone, government ID, health data) passed directly into a prompt is transmitted to the LLM without masking — this is a Privacy Act / GDPR violation in any regulated context
- The Trust Layer's data masking must be verified for every action that retrieves Salesforce record data before prompt injection

**FP-016 — Prompt injection surface:**
- User-supplied input must never be passed directly into an Agentforce prompt template without sanitisation
- A prompt template that includes `{UserInput}` verbatim allows a user to inject instructions that override the agent's system prompt — producing unauthorised actions
- Validate and sanitise user inputs before template injection; use Einstein Trust Layer's input validation where available

**FP-017 — Action catalogue bloat:**
- An Agentforce topic with more than 5 actions degrades intent resolution accuracy — the LLM must choose from too many options and produces ambiguous or incorrect action selection
- Split over-populated topics into focused sub-topics with clear intent boundaries
- Each action should have a unique, non-overlapping description — overlapping action descriptions cause random selection between equivalent actions

**FP-018 — Missing audit trail in regulated context:**
- Einstein Trust Layer audit logging must be enabled for all Agentforce agents operating in regulated industries (financial services, health, government)
- Audit logs capture: which user, which agent, which action, which data was accessed, at what time
- Absence of audit logging in a regulated context is a compliance violation — not a best practice gap

**FP-019 — Edition / licensing mismatch:**
- Agentforce features have edition and licensing dependencies — Agent Builder, Einstein Copilot, and specific agent actions require specific licences and Salesforce editions
- A design that calls for an Agentforce feature not available in the client's licensed edition will fail at activation, not at design review
- Confirm feature availability against the client's current Salesforce edition and licence inventory before committing to the design

**FP-020 — Weak confirmation gates on destructive actions:**
- Agentforce actions that perform destructive or high-value operations (delete records, submit orders, transfer funds, send regulated communications) must require explicit user confirmation before execution
- An agent that acts on a user's statement without a confirmation step is a liability — users mis-speak, the agent mishears, and irreversible actions execute without a safety check
- Design confirmation gates as a required step in the action flow, not an optional enhancement

## Category E — Security & Compliance Failures

**Sharing keyword sweep:**
- Every Apex class reachable from an external caller must declare `with sharing`
- Every Apex service and domain layer class must declare `inherited sharing`
- A class with no sharing keyword inherits its caller's context — if called from a system-context process, it runs as system and bypasses row-level security

**FLS enforcement sweep:**
- Every data-access path that returns data to an external user must call `Security.stripInaccessible()` on the result set before returning
- UI actions (AuraEnabled, LWC wire adapters) rely on the platform's FLS enforcement — custom REST endpoints and InvocableMethod callers do not get automatic FLS enforcement

**Guest user exposure:**
- Any Apex class, Flow, or LWC reachable by an Experience Cloud guest user (unauthenticated) must be explicitly reviewed for data exposure
- Guest users have no record ownership and no sharing grants — a `with sharing` class on a Private OWD object returns zero records; a `without sharing` class returns all records

## Common Failure Modes in SI Delivery

1. **Silent async failure** — Queueable throws an unhandled exception; the job fails with no log, no alert, and no retry; the operation is permanently lost; business users see no error and file no ticket; the gap is discovered in a monthly reconciliation
2. **Dual automation ownership** — Flow and Apex trigger both update the same field on Account after-save; under bulk DML, the field value is unpredictable; the defect never appears in single-record testing because only one automation fires fast enough to win
3. **Hardcoded ID survives sandbox but fails in production** — queue ID hardcoded during development; works in dev org where the queue has that exact ID; deployed to production where the same queue was created with a different ID; records assigned to null owner with no alert
4. **LDV object without index hits volume wall** — Service Log object designed for "a few thousand" records; reaches 2M in 18 months; dashboard SOQL queries time out; Salesforce Support engaged for custom index; 3-week lead time blocks UAT sign-off
5. **Agentforce PII exposure** — custom agent action retrieves Contact record and injects Name, Email, and TFN directly into a Prompt Template; Trust Layer data masking not configured; PII sent to LLM without masking; Privacy Act breach
6. **Mixed automation stack cascade** — Process Builder and record-triggered Flow both fire on Opportunity after-save; both attempt to create a Task; 200-record bulk update creates 400 Tasks; governor limit hit on the 150th DML; all 200 Opportunity updates roll back
7. **No dead-letter queue for integration failure** — Platform Event subscriber fails; `ProcessException` not handled; failed events dropped silently; no alert; downstream system diverges from Salesforce; discovered in audit 6 weeks later
8. **Missing rollback in multi-step migration** — data migration loads 500k records across 3 custom objects; load fails partway through Object 3; Objects 1 and 2 are committed with no rollback; data is in a partial state; no runbook documents the recovery path

## MANDATORY CHECK LIST

1. Automation ownership map completed — every key object has a documented list of active Triggers, Flows, Process Builder processes, and Workflow Rules; any overlap on the same field or operation is resolved
2. Governor limit stack modelled for the peak transaction — total SOQL, DML, CPU, and callout consumption confirmed within limits at 200-record bulk DML
3. Every async execution context (Queueable, Batch, Platform Event subscriber) has a try/catch with a persistent error log — no empty catch blocks, no silent failures
4. Every integration endpoint documents: API contract, error handling strategy, retry mechanism, idempotency key, dead-letter queue, and alerting threshold
5. Every outbound write callout carries an idempotency key — confirmed with the target API team that the key is honoured
6. No hardcoded record IDs, profile names, user names, or endpoint URLs in Apex, Flow, or metadata — all environment-specific config in Custom Metadata Types
7. Every LDV object (>1M records projected) has an indexing strategy and an archival strategy documented in the SDD
8. Every multi-step DML operation documents its rollback or compensating transaction strategy
9. Every Agentforce topic has a maximum of 5 actions; topics exceeding this are split
10. Every Agentforce agent has a documented human escalation path with explicit trigger criteria
11. Every Agentforce action that accesses personal data routes through Einstein Trust Layer with data masking configured
12. No user-supplied input passed directly into a Prompt Template without sanitisation
13. Einstein Trust Layer audit logging enabled for all agents in regulated-industry deployments
14. Agentforce feature and licence availability confirmed against the client's current Salesforce edition before design commitment
15. All destructive or high-value Agentforce actions require explicit user confirmation before execution
16. Every Apex class reachable from an external user declares `with sharing`; service and domain layers declare `inherited sharing`
17. FP-006 (silent async failure) — zero empty catch blocks in any async context across the codebase
18. Data migration runbook present: rollback criteria, cutover window, reconciliation count, post-migration validation queries
19. Mixed automation stack confirmed clear on all key objects — Process Builder and Workflow Rules deactivated and deleted where Flow replacement is deployed

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | FP-015 — PII passed into LLM prompt without Trust Layer masking in a regulated context (Privacy Act / GDPR breach); FP-006 — silent failure in financial transaction Queueable with no log and no alert — transactions permanently lost; FP-010 — dual automation stack both performing DML on the same field causes full batch rollback at 200-record bulk operation |
| HIGH | Performance, scalability, or reliability risk that will surface under production load. | FP-011 — LDV object with no indexing strategy — SOQL timeouts and report failures emerge at year-2 volume; FP-005 — outbound POST without idempotency key — duplicates created on any retry; FP-009 — no dead-letter queue for Platform Event failures — operational events permanently lost on any subscriber failure |
| MEDIUM | Technical debt or architectural drift that compounds over time. Fix within current release. | FP-007 — hardcoded org-specific IDs deploy successfully but fail silently at runtime in any non-source-org environment; FP-017 — Agentforce action catalogue bloat degrades intent resolution accuracy; FP-008 — no rollback strategy for multi-step DML — partial commit leaves data in inconsistent state on any mid-transaction failure |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | FP-012 — data migration runbook not yet drafted, cutover is months away — low immediate risk but must exist before UAT entry; FP-013 — Agentforce topic scope slightly over-broad but within manageable range — accuracy degradation not yet observed; FP-020 — confirmation gate missing on a low-value action (no financial or regulated data involved) |
