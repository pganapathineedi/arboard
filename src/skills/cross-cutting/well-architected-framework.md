# Salesforce Well-Architected Framework
*Reference for ARBoard agents. Every architectural recommendation must be grounded in one or more of these pillars. Flag explicitly when a design violates a Well-Architected principle.*

Source: architect.salesforce.com/docs/architect/well-architected

---

## The Three Pillars

**Trusted** — Protect the business, users, and data. Solutions are secure, compliant, and reliable by design.
**Easy** — Deliver value fast. Solutions are intentional, automated, and engaging by design.
**Adaptable** — Evolve with the business. Solutions are resilient and composable by design.

Priority order matters: Trusted > Easy > Adaptable. When trade-offs arise, always defer to the higher pillar.

---

## TRUSTED

### Secure
A secure system protects stakeholders and data. Secure architectures verify identities, restrict data access to only necessary information, and prevent data compromise.

**Key principles:**
- Apply principle of least privilege — always. Choose the simplest path to least privilege; avoid over-engineered sharing schemes.
- OWD default: Public Read Only unless data is sensitive — then Private. Never more permissive than required.
- Layered security: OWD → Role Hierarchy → Sharing Rules → Permission Sets → Field-Level Security
- Never hardcode credentials, endpoints, or tokens. Use Named Credentials and External Credentials.
- Use OAuth 2.0 JWT Bearer or Client Credentials for system integrations — never Basic Auth in production.
- mTLS required for high-sensitivity data (health, finance, government).
- Enable Event Monitoring and Transaction Security for threat detection in regulated orgs.
- CRUD/FLS checks required before any DML in Apex — never assume access.
- Minimum guest user access — never expose more than needed on Experience Cloud.

**Anti-patterns:**
- Hardcoded credentials in Apex or Flow
- Public OWD on sensitive objects (Account in FSC, Patient in Health Cloud)
- Missing sharing declarations on Apex classes
- No CRUD/FLS enforcement in triggers or service layers
- Basic Auth for external integrations

---

### Compliant
Solutions meet legal, regulatory, ethical, and accessibility standards.

**Key principles:**
- Identify applicable regulations early (GDPR, CCPA, HIPAA, SOC2, industry-specific)
- PII fields must be identified, documented, and either encrypted (Shield) or masked
- Audit trail required for regulated data — Field History Tracking or Big Object audit log
- Accessibility: WCAG 2.1 AA compliance for all Experience Cloud and LWC components
- Data residency requirements must be resolved before architecture is locked

**Anti-patterns:**
- PII in log fields (error logs, debug logs) without masking
- No data retention or archival policy for regulated data
- Missing audit trail on financial or medical records

---

### Reliable
Solutions remain available, performant, and resilient as demand, scale, and conditions change.

**Key principles:**
- Design for 200-record bulk scenarios from day one — never single-record assumptions
- Governor limits are not edge cases — calculate headroom at projected volume
- Every integration must have: retry logic, dead-letter queue, error alerting, and a recovery runbook
- Async-first for high-volume operations — Platform Events, Queueable, Batch Apex over synchronous callouts
- No synchronous callouts in trigger context on high-volume objects
- LDV objects (>1M records): custom indexes, skinny tables, selective SOQL, archival strategy required
- Test at 10x projected production volume before go-live

**Anti-patterns:**
- SOQL or DML inside loops [FP-007]
- No error logging — silent failures [FP-006]
- Synchronous callouts in trigger context on Account/Opportunity
- No bulk test coverage (single-record tests only)
- No archival strategy for objects expected to exceed 1M records

---

## EASY

### Intentional
Design solutions that prioritise business value, balance trade-offs, and remain understandable and maintainable over time.

**Key principles:**
- Declarative-first: Flow before Apex, standard objects before custom, native features before custom code
- Challenge every custom build — does Salesforce provide a native capability that makes this unnecessary?
- Complexity must be justified by business value — over-engineering is an anti-pattern [FP-011]
- One automation tool per object — establish this standard early and enforce it consistently [FP-010]
- Document every architectural decision — if it's not in an ADR, it didn't happen
- License cost is an architectural constraint — validate every proposed cloud and feature against current licensing

**Anti-patterns:**
- Custom code where Flow would suffice
- Multiple automation tools on the same object [FP-010]
- Lightest-tool principle applied without system consistency [FP-011]
- Architecture decisions made without license validation

---

### Automated
Enable work to happen faster and at scale by reducing manual effort and enforcing consistency.

**Key principles:**
- CI/CD pipeline required for all but trivial orgs — no change sets for regular deployments
- Unlocked packages preferred over unmanaged packages for modular delivery
- Automated testing: minimum 75% coverage, meaningful assertions, 200-record bulk tests
- Static analysis (PMD, Apex Analyzer) integrated into pre-commit hooks
- Deployment runbook documented for every go-live — including Named Credentials substitution steps

**Anti-patterns:**
- Change sets as primary deployment mechanism
- Coverage-only tests with no assertions
- No CI/CD pipeline
- Manual Named Credentials configuration at go-live

---

### Engaging
Solutions deliver user experiences that drive adoption and satisfaction.

**Key principles:**
- LWC + Dynamic Forms over legacy Page Layouts for new development [FP-012]
- Consolidate Lightning Record Pages — minimise proliferation [FP-012]
- OmniScript for guided step-by-step processes; FlexCards for data display — never swap these roles
- Progressive disclosure: show users only what they need, when they need it
- Mobile-first for field service, retail, and external-facing use cases

**Anti-patterns:**
- Separate Page Layout per record type when Dynamic Forms would suffice [FP-012]
- LWC for data display where FlexCard is available and licensed
- No mobile consideration for field-facing components

---

## ADAPTABLE

### Resilient
Solutions are prepared for change and disruption.

**Key principles:**
- Integration failures must not cascade — use Platform Events to decouple trigger from callout
- Dead-letter queue for failed events — never lose a message silently [FP-005, FP-006]
- Circuit breaker pattern for external integrations — stop calling a failing system
- Rollback plan required for every go-live — how do you recover if sync fails post-deployment?
- Monitoring and alerting: SLA defined, alerts wired, on-call runbook documented [FP-009]

**Anti-patterns:**
- Tight coupling between trigger and synchronous callout
- No dead-letter queue for Platform Event subscribers
- No rollback plan in deployment runbook
- Error logging without resolution path [FP-009]

---

### Composable
Solutions are built from small, independent parts that can be combined and extended.

**Key principles:**
- API-first: expose Salesforce capabilities via well-designed REST APIs for external consumption
- Modular package structure — each domain in its own unlocked package
- Reusable components: shared LWC library, shared DataRaptors, shared Integration Procedures
- External IDs on all objects that integrate with external systems — enables idempotent upserts
- Config-driven where possible — parameterise, don't hardcode

**Anti-patterns:**
- Monolithic org with no package boundaries
- No external IDs on integration objects — duplicate creation risk
- Hardcoded logic that should be configuration
- One-off LWC components with no reuse consideration

---

### Scalable
Solutions evolve as the business grows.

**Key principles:**
- Data model decisions made with 3-year volume projections, not current state
- API call volume analysis required before any integration design [FP-004]
- Bulk API 2.0 for data movement exceeding 1,000 records per operation
- MuleSoft payload sizing includes headroom for scope expansion [FP-008]
- Platform design decisions (OWD, sharing model, object relationships) are expensive to change — get them right upfront

**Anti-patterns:**
- Integration design without API limit analysis [FP-004]
- REST API for bulk data movement without volume calculation
- Data model designed for current volume only — no growth projection
- MuleSoft payload designed to exact current scope with no headroom [FP-008]

---

## Quick Reference — Agent Scoring Guide

When assessing a design against Well-Architected, score each pillar:

| Score | Meaning |
|-------|---------|
| ✅ Pass | Design explicitly addresses this pillar |
| ⚠️ Gap | Pillar not addressed — recommendation issued |
| 🔴 Violation | Design actively violates this pillar — Must Fix |

A design cannot be approved with any 🔴 Violation against Trusted pillar items.

---

*Source: Salesforce Well-Architected Framework — architect.salesforce.com*
*Last reviewed: July 2026*
