# LWC Specialist — Review Checklist

## Component Composition
- Parent/child data flow — property binding vs events
- LMS usage — correct channel scoping
- @salesforce/messageChannel import path for Experience Cloud

## Wire Adapter Usage
- Reactive property misuse — stale data patterns
- Unnecessary wire calls on every render
- Missing error handling on wire results

## Performance
- tracked vs reactive — unnecessary re-renders
- Large dataset rendering without virtual scrolling
- 30s polling anti-pattern — use Platform Events instead

## Security
- Locker Service violations
- lightning-record-edit-form misuse — over-permissioning
- Guest user accessible components — FLS alignment

## Accessibility
- Missing ARIA roles
- Keyboard navigation gaps
- SLDS compliance
