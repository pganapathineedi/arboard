# Integration Reliability Patterns

## Error Handling
- HTTP error codes — handle 4xx and 5xx explicitly
- Timeout handling — named credential timeout settings
- Partial success — batch API error handling

## Reliability Patterns
- Idempotency keys — prevent duplicate processing
- Exponential backoff — retry with delay
- Dead letter queue — failed message handling
- Circuit breaker — stop cascading failures

## Async Integration
- Platform Events — replay buffer sizing
- CDC — subscription management
- Outbound Messages — retry behaviour and endpoint reliability

## Relevant Agents
- sf-integration, sf-apex, sf-flow

## MANDATORY CHECK LIST
1. All HTTP callouts explicitly handle 4xx and 5xx status codes — not only catching Java/Apex exceptions
2. Named Credential timeout value configured — not relying on the indefinite Salesforce platform default
3. Idempotency key implemented for all inbound integration events — duplicate messages produce no duplicate records
4. Retry logic uses exponential backoff with a defined maximum attempt count
5. Dead letter queue or dead letter object defined — failed messages beyond the retry limit are captured for review
6. Circuit breaker pattern evaluated for every integration to an unreliable or latency-sensitive downstream system
7. Platform Event replay buffer size reviewed — default 3-day buffer confirmed appropriate for subscriber downtime tolerance
8. CDC subscription management documented — subscriber resilience to replay and event replay ordering confirmed
9. Outbound Message endpoint retry behaviour and SLA confirmed with the receiving team
10. Partial success from bulk API handled explicitly — partial failure never treated as full success
11. All integration callout outcomes logged to a custom log object — not relying on System.debug() alone
12. Integration failure ownership defined per failure category — owning team, alert mechanism, and resolution SLA documented

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | No HTTP error handling — a 503 from a downstream system causes silent data loss with no retry or alert; No idempotency — duplicate inbound events create duplicate Account, Contact, or Order records that cannot be automatically reconciled |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | No retry on transient failures — a single timeout permanently fails the record with no recovery path; No dead letter queue — failed records beyond the retry limit are silently discarded with no visibility or recovery mechanism |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Platform Event replay buffer not sized for subscriber downtime — events are lost when the subscriber is offline for more than 3 days; Circuit breaker absent — one slow downstream dependency causes cascading timeouts across unrelated integrations |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Outbound Message retry behaviour not documented — on-call team cannot determine how many retries have occurred or when the message is abandoned; Integration log object has no purge/archival strategy — log grows unbounded and creates an LDV concern over time |
