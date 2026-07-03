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
