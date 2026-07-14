# SI Failure Patterns — Cross-Domain Review Checklist

## Purpose
This skill file grounds the sf-patterns agent in known SI delivery failure patterns.
Every check below maps to a documented failure pattern (FP-004 to FP-020).

## MANDATORY CHECK LIST
1. FP-004 — Integration contracts undocumented: every external system integration has a defined API contract, error handling strategy, and owner
2. FP-005 — No retry/idempotency on outbound calls: all outbound integrations implement idempotency keys and retry logic
3. FP-006 — Silent failure in async: every Queueable, Batch, and Platform Event handler has a persistent failure log — no empty catch blocks
4. FP-007 — Hardcoded environment config: no org IDs, profile IDs, or endpoint URLs hardcoded in Apex or Flow
5. FP-008 — Missing rollback strategy: multi-step DML operations define explicit rollback or compensating transaction behaviour
6. FP-009 — No dead letter handling: failed async messages have a dead letter queue or manual recovery path documented
7. FP-010 — Mixed automation stack: no parallel use of Workflow Rules, Process Builder, and Flow on the same object without consolidation plan
8. FP-011 — LDV object without indexing: any object projected to exceed 1M records has an external ID and custom index strategy
9. FP-012 — No data migration runbook: data migration scope defines rollback criteria, cutover window, and post-migration validation steps
10. FP-013 — Agentforce over-broad topic scope: each Agentforce topic has a tightly scoped instruction set with defined boundaries
11. FP-014 — Missing escalation path: every Agentforce agent has a defined human-in-the-loop or fallback for unresolvable intents
12. FP-015 — Ungrounded agent actions: all Agentforce custom actions mask PII through Einstein Trust Layer before LLM context injection
13. FP-016 — Prompt injection surface: user-supplied input is never passed directly into Agentforce prompt templates without sanitisation
14. FP-017 — Action catalogue bloat: no Agentforce topic has more than 5 actions; excess actions split into separate topics
15. FP-018 — Missing audit trail: Einstein Trust Layer audit logging enabled for all Agentforce agents in regulated orgs
16. FP-019 — Edition/licensing mismatch: design does not depend on Agentforce features unavailable in the licensed Salesforce edition
17. FP-020 — Weak confirmation gates: all destructive or high-value Agentforce actions require explicit user confirmation before execution

## SEVERITY RUBRIC
| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | FP-015 — PII exposed in LLM context without Trust Layer masking (Privacy Act breach); FP-006 — silent async failure in financial transaction processing — no log, no recovery, no audit trail |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | FP-011 — LDV object with no index strategy — query timeouts at scale; FP-010 — mixed automation stack triggers cascading governor limit failures on bulk record operations |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | FP-007 — hardcoded endpoint URLs block environment promotion without manual code changes; FP-017 — action catalogue bloat degrades Agentforce intent resolution accuracy over time |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | FP-008 — rollback strategy undocumented but single-step DML only — low immediate blast radius; FP-012 — no migration runbook drafted but cutover is months away |
