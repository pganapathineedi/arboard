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

## MANDATORY CHECK LIST
1. Wire adapter results handle both `data` and `error` branches explicitly — no missing error state UI
2. `@track` not used where a plain reactive property or `@api` suffices — avoid unnecessary re-render triggers
3. `@api` properties never mutated inside the component — one-way data flow enforced
4. Events follow containment — fired upward via `dispatchEvent`, never reaching down into child internals
5. `getRecord` wire adapter lists only the fields the component actually renders — no over-fetching
6. ARIA roles and labels present on all interactive elements (icon-only buttons, custom controls)
7. Keyboard navigation tested — every interactive element reachable and operable without a mouse
8. SLDS utility classes used for all styling — no hard-coded colours, pixel values, or inline styles
9. Experience Cloud restrictions verified — LMS channel scoping correct, Guest User FLS alignment confirmed
10. No `setInterval` polling pattern — replaced by Platform Events or Streaming API subscription
11. Component has single responsibility — no monolithic LWC exceeding ~300 lines without decomposition
12. No direct DOM manipulation across component boundaries — Locker Service / LWS compliance verified

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Guest-user-accessible component exposes fields without FLS enforcement — unauthenticated user reads restricted PII (data breach); Locker Service violation crashes component in LEX or Experience Cloud — feature completely non-functional |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Wire adapter missing `error` branch — record fetch failure renders a silent blank UI with no user feedback; `@api` property mutated internally — breaks parent state management and causes unpredictable cascading re-renders |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | `getRecord` fetching all fields instead of a named field list — excess data transfer and fragile field-permission dependency; Single 500-line monolithic LWC — untestable in isolation, blocks future decomposition |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Missing ARIA label on icon-only button — WCAG non-compliance flagged in accessibility audit; `@track` on a primitive where it has no effect — misleads future developers about reactivity intent |
