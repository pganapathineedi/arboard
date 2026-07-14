# Error Handling & Resolution Ownership

## Core Principle (FP-006, FP-009)
Every integration or async operation must define: what happens when it fails, who owns resolution, and how the failure is logged. Silent failures are unacceptable in production.

## Logging Framework
- Custom log object (Integration_Log__c or similar) — capture every callout outcome
- Required fields: Record_Id, Endpoint, HTTP_Status, Request_Body, Response_Body, Timestamp, Is_Success
- Platform Event-based logging for high-volume async contexts
- Never use System.debug() as the sole logging mechanism in production code

## Retry Patterns
- Exponential backoff — retry with increasing delay (1s, 2s, 4s, 8s)
- Maximum retry limit — define explicitly, never infinite retry
- Idempotency — ensure retried operations don't create duplicate records
- Dead letter queue — failed records that exceed retry limit must go somewhere

## Resolution Ownership
- Every failure must have a defined owner — which team, which queue, which alert
- SLA for resolution — define acceptable time-to-resolve for each failure category
- Escalation path — what happens if resolution SLA is breached

## Exception Handling in Apex
- try/catch in all async contexts (Queueable, Batch, Future)
- Never swallow exceptions silently — always log
- Database.SaveResult / Database.UpsertResult — always check isSuccess()
- Partial success in Batch — define allOrNone strategy explicitly

## Common Anti-patterns
- Empty catch blocks
- System.debug() only logging
- No retry on transient failures
- Missing fault connectors in Flow

## Relevant Agents
- sf-apex, sf-integration, sf-flow, sf-patterns

## MANDATORY CHECK LIST
1. No empty catch blocks — every caught exception is logged with at minimum the record ID, endpoint, and timestamp
2. No `System.debug()` as the sole logging mechanism for any production error path
3. Custom log object (Integration_Log__c or equivalent) captures all callout outcomes
4. Log record includes all required fields: Record_Id, Endpoint, HTTP_Status, Request_Body, Response_Body, Timestamp, Is_Success
5. `Database.SaveResult` and `Database.UpsertResult` always checked for `isSuccess()` — never assumed successful
6. Batch Apex `execute()` has try/catch — a single record failure must not abort the entire chunk
7. All async contexts (Queueable, Batch, Future) have try/catch with an explicit, persistent log call
8. Retry logic has a defined maximum attempt limit — no infinite retry loop
9. Dead letter queue or dead letter object defined — records exceeding the retry limit are captured for manual review
10. Every failure category has a named owner and a documented resolution SLA
11. Exponential backoff implemented for retry — not a fixed-interval loop
12. Flow fault connectors present on every DML element — no silent Flow failure path

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Empty catch block in Batch `execute()` — exception is swallowed, records silently not processed with no alert or log; No logging in async integration — production failure leaves zero audit trail, data loss goes undetected for days |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | `Database.SaveResult` not checked for isSuccess() — partial DML failure treated as success, corrupted state persists in the org; Infinite retry loop on a dead endpoint — fills the async job queue and starves all other org background jobs |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | `System.debug()` only logging — debug logs are purged after 24 hours, leaving no persistent record of production errors; No dead letter queue — records beyond the retry limit are permanently discarded with no recovery path |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Fixed-interval retry instead of exponential backoff — hammers a failing downstream system, worsening its recovery time; Resolution ownership not documented — on-call team does not know which team to escalate to for each failure type |
