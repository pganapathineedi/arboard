# Apex Specialist — Review Checklist

## Bulkification & Governor Limits
- Detect SOQL/DML inside loops
- Identify governor limit breach patterns (heap, CPU, SOQL 101)
- Flag missing bulkification in batch, queueable, trigger contexts

## Trigger Framework
- One trigger per object pattern
- Trigger handler delegation — no logic in trigger body
- Missing before/after context separation

## Async Patterns
- Queueable chaining depth
- Batch scope sizing — too large or too small
- Future method misuse — no callouts from batch, no future from future

## Exception Handling
- Missing try/catch in async contexts
- No custom logging framework
- Rollback strategy undefined

## Test Coverage
- Missing @testSetup
- No assertions — assert-free tests
- No negative/bulk test scenarios
