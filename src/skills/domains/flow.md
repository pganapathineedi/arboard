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
