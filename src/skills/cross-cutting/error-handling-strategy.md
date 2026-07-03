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
