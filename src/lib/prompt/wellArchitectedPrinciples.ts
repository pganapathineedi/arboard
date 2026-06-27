export const WELL_ARCHITECTED_BY_AGENT: Record<string, string> = {

  apex: `## Salesforce Well-Architected — Apex & Automation
- Triggers must be bulkified: never perform SOQL queries or DML inside loops. Use collections.
- One trigger per object. Use a handler class pattern to dispatch logic by context.
- Avoid synchronous callouts from triggers — use async patterns (Queueable, Platform Events) for external calls at volume.
- Batch Apex must implement error partitioning — a single record failure must not roll back the entire batch scope.
- CPU time limit: complex algorithms must be load-tested at full data volume before go-live. 800ms+ per 200 records is a risk.
- Scheduled Apex: no more than 100 scheduled jobs. Consolidate where possible.
- Always implement retry logic for outbound callouts. Log failures to a dedicated integration log object.`,

  integration: `## Salesforce Well-Architected — Integration
- Prefer Platform Events over Outbound Messaging for async integration — better reliability, replay capability, and governor limit handling.
- Synchronous callouts from Apex triggers are a risk at volume — consider Queueable Apex or Platform Events to decouple the callout.
- All integration endpoints must use Named Credentials — never hardcode credentials.
- Implement idempotency: reprocessing the same message must not create duplicate records.
- Design for failure: every integration must have a dead-letter queue or manual retry mechanism.
- API-led connectivity: version all APIs. Breaking changes require a new version, not in-place modification.
- Rate limits: Salesforce enforces per-org API limits. High-volume integrations must implement throttling and backoff.`,

  lwc: `## Salesforce Well-Architected — LWC & Experience Cloud
- Never poll for updates using setInterval or @wire refresh at scale — use Platform Events or Streaming API for real-time updates.
- Guest User profiles must follow least-privilege: grant only the minimum object/field permissions required. Create/Edit on Contact for a guest user is a critical security risk.
- LWR (Lightning Web Runtime) sites require explicit CSP configuration — third-party scripts must be whitelisted.
- Component data loading: use @wire for declarative data binding. Avoid imperative Apex calls on every render.
- Portal performance: lazy-load heavy components. Each additional Apex call on page load adds latency for all concurrent users.
- At 2,000+ concurrent portal sessions, 30-second polling creates ~4,000 API calls per minute — use CometD/Streaming API instead.`,

  data: `## Salesforce Well-Architected — Data & Schema
- External IDs must be indexed. Upsert operations on non-indexed external ID fields degrade at volume.
- Skinny tables: for objects exceeding 1M records, work with Salesforce support to define skinny tables for frequently-queried field combinations.
- Data archiving: define a retention and archiving strategy for high-volume objects before go-live. Integration logs at 2M records/year will hit storage limits within 3 years without archiving.
- Relationship design: avoid deeply nested lookups (more than 5 levels) — SOQL traversal limits apply.
- PII fields: all personally identifiable information must be identified in the data model and covered by a field-level security policy before go-live.
- Platform Encryption: Shield Platform Encryption adds query overhead — only encrypt fields that require it for compliance. Do not encrypt fields used in WHERE clauses.`,

  designer: `## Salesforce Well-Architected — Architecture & Design
- Salesforce-native first: exhaust declarative options (Flow, OmniStudio, standard objects) before writing Apex.
- Configuration over customisation: custom code increases upgrade risk and maintenance burden.
- Single source of truth: avoid storing the same data in multiple systems. Define which system owns each entity.
- Design for scale from day one: a pattern that works at 10,000 records often fails at 1,000,000.
- Dependency management: document all external dependencies (middleware, APIs, packages). Each is a failure point.
- Change management: all production changes must go through a defined deployment pipeline. No direct production edits.
- Well-Architected pillars: every design decision should be assessed against Security, Reliability, Performance, and Operability.`,

  patterns: `## Salesforce Well-Architected — SI Failure Patterns
- FP-004: API limit breach during bulk integration — batch jobs hitting per-org API limits mid-run. Always calculate API call volume before go-live.
- FP-005: CDC workaround without error handling — Change Data Capture consumers that silently swallow errors, causing data drift.
- FP-006: No error logging designed in — integrations with no visibility into failures. Every integration needs an observable failure state.
- FP-007: SOQL inside loop — the most common Apex governor limit breach. No exceptions.
- Anti-pattern: God trigger — a single trigger handling all logic for an object, impossible to test or extend.
- Anti-pattern: Hardcoded IDs — record type IDs, profile IDs, or custom setting values hardcoded in Apex. Always query or use custom metadata.
- Anti-pattern: Synchronous everything — all external calls made synchronously. One slow API brings down the entire transaction.`,

  flow: `## Salesforce Well-Architected — Flow & Automation
- One automation entry point per object per trigger event. Multiple record-triggered flows on the same object/event create unpredictable execution order.
- Avoid Flow calling Apex calling Flow — circular dependencies cause CPU limit breaches.
- Bulkification: record-triggered flows are bulkified by default but Apex actions called from Flow are not — ensure Apex actions accept collections.
- Error handling: all flows must have fault paths defined. An unhandled fault in a record-triggered flow rolls back the entire transaction.
- Screen flows on Experience Cloud: each screen load is an API call. Multi-step forms with 10+ screens create significant API consumption at scale.
- Subflows: use subflows for reusable logic, but be aware each subflow call counts toward the 2,000 element limit per interview.`,

  omni: `## Salesforce Well-Architected — OmniStudio
- DataRaptors should never be used for high-volume real-time queries — cache results where possible or use Integration Procedures.
- Integration Procedures are preferred over Apex for OmniStudio data operations — they are declarative and easier to maintain.
- OmniScripts must be tested at full field count — performance degrades significantly with 50+ fields per step.
- FlexCards making multiple DataRaptor calls on load create N+1 query patterns — consolidate into a single Integration Procedure.
- Version control: OmniStudio components must be exported and stored in source control. They are not automatically tracked by Git.
- Namespace dependencies: if migrating from Vlocity to OmniStudio, verify all namespace references are updated before deployment.`,

  judge: `## Salesforce Well-Architected — Judge Reference
- Reliability: single points of failure must be identified and mitigated. No synchronous critical path should depend on a single external system without a fallback.
- Security: least-privilege applies everywhere — profiles, permission sets, guest users, integration users, and named credentials.
- Performance: validate all volume assumptions with load testing before go-live. Architect for peak load, not average load.
- Operability: every integration needs logging, alerting, and a manual retry mechanism. Invisible failures are production incidents waiting to happen.
- Upgradability: custom code and unpackaged metadata must be documented. Undocumented customisations block Salesforce releases.
- A recommendation is only APPROVED if it addresses all five pillars. Partial compliance warrants APPROVED_WITH_CONDITIONS.`,
};
