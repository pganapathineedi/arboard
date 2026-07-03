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
