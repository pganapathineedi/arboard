# Async-First Architecture Patterns

## When Async is Required
- Callouts from DML context — must be async
- Long-running operations — Batch or Queueable
- High-volume trigger processing — Platform Events + async consumer

## Anti-patterns
- Synchronous callout from trigger — System.CalloutException risk
- Future method from loop — governor limit breach
- Chained futures — use Queueable instead

## Correct Patterns
- Platform Event publish → async subscriber
- Queueable with retry logic
- Batch with appropriate scope size (200 default)

## Relevant Agents
- sf-apex, sf-integration, sf-flow

## MANDATORY CHECK LIST
1. No HTTP callout in a synchronous DML-active context — must be moved to Future/Queueable
2. No `@future` method called inside a loop — each invocation counts against the 50-per-transaction future limit
3. Chained `@future` methods replaced with Queueable — Queueable supports chaining and callouts natively
4. Batch Apex scope size ≤ 200 by default; callout-heavy or LDV batches use scope ≤ 50 with documented justification
5. Platform Events used for high-volume trigger decoupling — not synchronous DML chains in the trigger
6. Async Platform Event subscriber handles replay buffer and implements idempotency on event processing
7. Queueable jobs implement retry logic with a defined maximum attempt count — no silent single-attempt failure
8. Every Queueable chain has an explicit termination condition — no infinite chaining pattern
9. Batch Apex `execute()` method has try/catch — an exception in one chunk must not abort the entire job
10. `@future` methods declared `static void` — no return value, no attempt to chain from a future context

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Synchronous callout from a DML-active context — `System.CalloutException: You have uncommitted work pending` thrown in production for every affected record; `@future` called inside a loop — hits the 50-future limit, remaining records are silently skipped with no error |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | No try/catch in Batch `execute()` — a single bad record exception kills the entire batch chunk, leaving the rest of the batch unprocessed; Infinite Queueable chain with no termination condition — fills the async job queue and starves all other org jobs |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | `@future` used where Queueable is appropriate — loses job ID observability, no chaining, no callout support in all contexts; Batch scope set to 2000 on a complex operation — heap limit breach emerges only under production data volumes |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Platform Events not used for high-volume trigger decoupling — synchronous chains work in test but degrade under production load; No retry logic in Queueable — transient external errors result in a permanent unrecoverable data inconsistency |
