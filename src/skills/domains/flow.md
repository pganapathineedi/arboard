# Flow Specialist — Review Checklist

## DML & Performance
- DML inside loops — Get Records / Update Records in iterations
- Unnecessary record queries — cache where possible
- Large payload screen flows

## Error Handling
- Missing fault connectors on DML elements
- Silent failures — no user feedback on error paths
- Unhandled null values from Get Records

## Trigger Conflicts
- Redundant record-triggered flows conflicting with Apex triggers
- Flow + Apex both updating same object — order of execution risk

## Hygiene
- Deactivated flows not deleted
- Orphaned scheduled flows
- No naming convention compliance

## Reusability
- Subflow usage — duplicated logic across flows
- Auto-launched vs screen flow correct selection

## MANDATORY CHECK LIST
1. Every DML element (Create/Update/Delete Records) has a fault connector wired to an explicit error path
2. Every Get Records element handles the zero-results case — null check before referencing the variable
3. No Get Records or DML elements inside loop iterations in record-triggered flows
4. Sub-flow invocations have a fault connector — errors propagate up and are not silently swallowed
5. Predecessor Workflow Rules and Process Builder on the same object are deactivated and deleted before go-live
6. Only one active version per flow at any time — old versions deleted after UAT sign-off
7. Flow name follows the agreed naming convention — object, event/type, and purpose in the name
8. Scheduled flows have a finite record scope or an explicit end condition — no runaway infinite schedule
9. Auto-launched flows invoked from Apex do not duplicate what the Apex trigger already handles on the same record
10. Screen flows validate all required user inputs before executing DML — no null/blank submission path
11. Flow and Apex automation ownership documented per object — no dual ownership on the same operation
12. Bulkification verified — record-triggered flow tested with a 200-record data import

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | DML element inside a loop in a record-triggered flow — guaranteed governor limit failure on any bulk operation; Missing fault connector on Update Records — silent partial failure leaves related records in an inconsistent state |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Flow and Apex trigger both performing DML on the same record in the same transaction — order of execution produces unpredictable field values at scale; Sub-flow invoked without a fault path — unhandled exception terminates the entire parent flow transaction |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Deactivated old flow versions not cleaned up — clutters metadata, confuses admins during incident response; Screen flow has no input validation — users can submit blank required fields, causing intermittent DML errors |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Flow name violates naming convention — automation registry audit is manual and error-prone; Duplicated logic across two auto-launched flows instead of a shared sub-flow — logic drift accumulates over time |
