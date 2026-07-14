# ARBoard — SI Failure Pattern Library
*Accenture Salesforce delivery failure patterns. Reference these in every review. Flag explicitly when a design matches a known pattern.*

---

## FP-004 — API limit breach during bulk integration
**Severity:** High | **Components:** Integration, Data

**Scenario:** Integration design proceeded without upfront API limit analysis. Bulk data sync via REST API hit the daily API call limit on day 3 of UAT. Redesign to Bulk API 2.0 delayed go-live by 3 weeks.

**Better path:** Before any integration design, calculate projected API call volumes against Salesforce limits. For high-volume data movement, default to Bulk API 2.0. Build error logging and retry mechanisms from day one.

---

## FP-005 — Direct DB query via MuleSoft as CDC workaround — no error handling or retry
**Severity:** Medium | **Components:** Integration, OmniStudio

**Scenario:** Platform Events hit governor limits under large transaction volumes, so the team routed CDC through MuleSoft querying the database directly — without error logging or retry logic. Silent failures caused data sync gaps not detected until downstream reporting showed inconsistencies weeks later.

**Better path:** Direct DB queries as a CDC workaround can be valid, but must include: connection pooling, retry with exponential backoff, dead-letter queue for failed events, and end-to-end reconciliation checks. Never deploy integration workarounds without monitoring.

---

## FP-006 — No error logging designed in — failures invisible until production incident
**Severity:** High | **Components:** Apex, Flow, Integration

**Scenario:** Apex trigger and integration code deployed to production with no centralised error logging. When a trigger failed silently on a subset of records during a bulk load, the issue surfaced 2 weeks later via a client complaint — investigation required manual log trawling across 3 systems.

**Better path:** Design error logging as a first-class requirement, not an afterthought. Use a Platform Event-based logging framework or custom object. Every trigger, flow, and integration must log failures with context from day one of development.

---

## FP-007 — SOQL query inside loop — governor limit hit during bulk trigger execution
**Severity:** High | **Components:** Apex

**Scenario:** Developer wrote a SOQL query inside a for-loop within an Apex trigger. Functioned correctly in dev org with small data sets. In production, a batch load of 200 records triggered the "too many SOQL queries: 101" limit, causing the entire batch to fail and roll back — with no alerting until client reported missing records.

**Better path:** Bulkify all Apex — collect record IDs, query once outside the loop, map results, then iterate. Enforce via code review checklist. Use a trigger framework such as FFLIB that enforces bulkification patterns by design.

---

## FP-008 — MuleSoft heap size breach due to payload scope creep
**Severity:** Medium | **Components:** Integration

**Scenario:** Integration payload was designed for initial scope, then expanded as business requirements grew without reassessing heap size constraints. Payloads exceeded MuleSoft heap limits under production load, causing integration failures.

**Better path:** Split integrations into smaller modular elements. Even if initial design stays within limits, build in headroom for scope expansion. Reassess heap usage at every scope change.

---

## FP-009 — Error logging without resolution path — log and hope
**Severity:** High | **Components:** Apex, Flow, Integration

**Scenario:** Designs that end at "log the error" rather than "log the error and ensure resolution." Support teams were handed error logs with no runbook, no escalation path, and no context on how to resolve. Errors sat unresolved because the supporting team had no guidance.

**Better path:** Error handling design must include: who owns resolution, what the remediation steps are, and how the supporting team is informed and trained. Logging is not a resolution strategy.

---

## FP-010 — Multiple automation tools per object — ad hoc trigger decisions
**Severity:** High | **Components:** Apex, Flow

**Scenario:** Automations were added to objects based on what made sense for each individual change, resulting in a mix of Flows and Apex Triggers on the same object. Each design made ad hoc decisions on whether logic belonged in Flow or Apex, leading to unpredictable execution order, duplicated logic, and difficult troubleshooting.

**Better path:** Establish one automation tool per object based on criticality and volume. Hot objects use Apex Triggers; non-hot objects default to Flow. Enforce this consistently across the delivery.

---

## FP-011 — Lightest-tool principle applied without system consistency — unusable UX
**Severity:** Medium | **Components:** Solution Design

**Scenario:** Following best practice to use the lightest tool for each use case resulted in a system where different objects used different automation approaches, UI patterns, and interaction models. Users described the system as requiring "a degree in the platform" to use.

**Better path:** Set UI and performance standards early. Choose technology that aligns to those standards consistently — sometimes that means using a heavier tool than strictly necessary. Value system consistency over the smallest cost per work unit.

---

## FP-012 — Heavy reliance on Page Layouts — performance and maintainability degradation
**Severity:** Medium | **Components:** LWC, Solution Design

**Scenario:** Team defaulted to creating separate Page Layouts and Lightning Record Pages per record type, even when dynamic rendering was required. Proliferation of LRPs and Page Layouts led to poor page performance, high maintenance overhead, and inconsistent UX across the org.

**Better path:** Leverage Lightning Record Pages with Dynamic Forms over legacy Page Layouts. Consolidate screen requirements into a minimal number of LRPs per object. Only create new LRPs when dynamic components exceed ~10.

---

## FP-013 — Over-broad Topic Scope
**Severity:** High | **Risk:** High | **Pillars:** Reliability, Security | **Components:** Agentforce

**Scenario:** An Agentforce topic was defined with a vague mandate such as "help customers with their account." With no exclusion list or scope boundaries, the agent invoked actions outside its intended domain — including high-consequence financial actions — in response to ambiguous user inputs. Discovered in UAT when test users triggered unintended account closures.

**Better path:** Every topic must have a precise mandate, explicit exclusion list, and routing topic defined for out-of-scope requests. Review topic instructions against the Agentforce Well-Architected guidance on topic clarity. Test with adversarial inputs before go-live.

---

## FP-014 — Missing Escalation Path
**Severity:** High | **Risk:** High | **Pillars:** Reliability, Customer Experience | **Components:** Agentforce

**Scenario:** An Agentforce deployment for service handling had no fallback path or human-in-the-loop defined for any topic. When the agent encountered ambiguous requests or repeated failures, it looped or returned unhelpful responses with no ability to hand over to a live agent. Escalation complaints surfaced within hours of go-live.

**Better path:** Every topic must define at least one escalation path — human handover with full conversation context, a fallback topic, or an explicit failure message. Test the escalation path in UAT with edge cases. Never deploy a topic without a defined exit for failure scenarios.

---

## FP-015 — Ungrounded Agent Actions
**Severity:** Critical | **Risk:** Critical | **Pillars:** Security, Compliance | **Components:** Agentforce

**Scenario:** Agent actions retrieved customer PII (account numbers, tax file numbers) from Salesforce records and passed the raw values into the LLM context without Einstein Trust Layer data masking configured. In a regulated financial services context, this constituted a data residency breach under the Australian Privacy Act and potential APRA CPS 234 non-compliance. Discovered during security review after a near-production deployment.

**Better path:** Configure Einstein Trust Layer data masking for all PII fields before any agent action retrieves sensitive data. Audit every action's data access against your data classification policy. In regulated industries, ETL configuration is mandatory, not optional.

---

## FP-016 — Prompt Injection Surface
**Severity:** High | **Risk:** High | **Pillars:** Security | **Components:** Agentforce

**Scenario:** A Prompt Template for a customer service agent passed the raw user-provided "reason for contact" field directly into the prompt without sanitisation. An adversarial user submitted a prompt injection payload that overrode the agent's instructions, causing it to return internal system information and bypass its guardrails.

**Better path:** Never pass raw user input directly into prompt templates. Sanitise and validate all user-provided inputs before injection. Use bounded prompt templates with explicit role separation. Test prompt templates against OWASP LLM injection patterns before deployment.

---

## FP-017 — Action Catalogue Bloat
**Severity:** Medium | **Risk:** Medium | **Pillars:** Performance, Reliability | **Components:** Agentforce

**Scenario:** A single Agentforce topic was configured with 14 actions across multiple functional domains. The LLM's ability to select the correct action degraded significantly — in testing, the agent invoked incorrect actions in approximately 30% of test cases. The root cause was exceeding the recommended action count per topic, which degrades LLM selection accuracy.

**Better path:** Limit action catalogues to ≤8 actions per topic. If more actions are required, split into multiple focused topics with clear routing logic. Write action descriptions that are unambiguous and mutually exclusive to aid LLM selection accuracy.

---

## FP-018 — Missing Audit Trail Configuration
**Severity:** High | **Risk:** High | **Pillars:** Security, Compliance | **Components:** Agentforce

**Scenario:** An Agentforce deployment for a financial services client went live without Einstein Trust Layer audit logging enabled. When a dispute arose about an agent-initiated action on a customer account, there was no forensic record of the conversation, actions invoked, or data accessed. For financial services, minimum 7-year retention of interaction records is required under regulatory obligations.

**Better path:** Enable ETL audit logging before go-live in any regulated context. Verify log retention policy meets regulatory requirements. Include ETL logging configuration as a mandatory item in your Agentforce deployment checklist.

---

## FP-019 — Edition/Licensing Mismatch
**Severity:** High | **Risk:** High | **Pillars:** Delivery Excellence | **Components:** Agentforce

**Scenario:** A solution design included Agentforce for Sales with Data Cloud grounding, assuming features available in the Unlimited+ edition. The client was licensed for Enterprise edition. The features were not available, requiring a major redesign three weeks before go-live. The licensing assumption had not been validated at any prior design checkpoint.

**Better path:** Verify every Agentforce feature against the client's licensed edition and available add-ons at the start of design. Confirm Data Cloud licensing separately — it is not included in core Agentforce licences. Document edition assumptions explicitly in the SDD.

---

## FP-020 — Weak Confirmation Gates
**Severity:** High | **Risk:** High | **Pillars:** Reliability, Security | **Components:** Agentforce

**Scenario:** An Agentforce agent for account management was configured to process refunds and account closures without any user confirmation step. A miscommunication between a customer and the agent resulted in an unintended account closure that required manual reversal. No confirmation gate was present because the design treated all agent actions equivalently.

**Better path:** Classify agent actions by consequence level. High-consequence actions (financial transactions, account changes, data deletion) must include an explicit confirmation gate before execution. Use Agentforce's built-in confirmation flow capabilities. Test confirmation gates with adversarial and ambiguous inputs.

---

*Last exported: July 2026. Refresh quarterly from Supabase failure_patterns table.*
