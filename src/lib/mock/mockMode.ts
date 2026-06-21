import type { ImpactAnalysis } from "@/lib/types";

export function isMockMode(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !key || key === "mock";
}

// Simulates streaming by yielding chunks with realistic pacing
export async function* mockStream(text: string): AsyncGenerator<string> {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i] : " " + words[i];
    yield chunk;
    await new Promise((r) => setTimeout(r, 18 + Math.random() * 22));
  }
}

export function getMockImpactAnalysis(): ImpactAnalysis {
  return {
    summary:
      "The request involves building a Customer 360 self-service portal on Experience Cloud with real-time SAP order integration via MuleSoft and Einstein Bot-powered case deflection. This spans multiple Salesforce clouds, a complex integration layer, and significant UI customisation — representing high architectural complexity with cross-cutting governor limit risk.",
    overallRisk: "high",
    estimatedComplexity: "high",
    activatedAgents: [
      {
        agentId: "sf-designer",
        agentName: "Salesforce Solution Designer",
        reason:
          "Multi-cloud architecture spanning Sales Cloud, Service Cloud, and Experience Cloud requires authoritative solution design and data model decisions before any build begins.",
        sfRisks: [
          "Sharing model complexity for Experience Cloud guest users accessing order data",
          "Cross-cloud data residency and record ownership conflicts",
          "Integration API volume approaching Salesforce API call limits at scale",
        ],
        priority: "required",
      },
      {
        agentId: "sf-lwc",
        agentName: "LWC & Experience Cloud Specialist",
        reason:
          "Experience Cloud portal requires custom LWC components for order tracking timeline and case submission UI — including guest user context and LMS event handling.",
        sfRisks: [
          "LWC components on Experience Cloud lacking proper guest user profile scoping",
          "Lightning Message Service cross-component communication on community pages",
          "SLDS customisation conflicts with Experience Cloud base theme tokens",
        ],
        priority: "required",
      },
      {
        agentId: "sf-apex",
        agentName: "Apex & Integration Specialist",
        reason:
          "MuleSoft integration callbacks and Einstein Bot handoff logic require Apex REST endpoints and async processing patterns with error handling.",
        sfRisks: [
          "Apex CPU limit risk in synchronous MuleSoft callback handlers processing order payloads",
          "Queueable chain depth for order status update fan-out to child records",
          "Mixed DML exceptions when Einstein Bot transfers cases to human agents",
        ],
        priority: "required",
      },
      {
        agentId: "sf-flow",
        agentName: "Flow & Automation Specialist",
        reason:
          "Case deflection routing logic and order status notification workflows are candidates for declarative Flow automation before considering Apex.",
        sfRisks: [
          "Record-triggered Flow recursion on Case status updates from bot handoff",
          "Flow interview CPU limit when evaluating complex deflection rules at scale",
          "Scheduled Flow governor limits for batch order status sync notifications",
        ],
        priority: "recommended",
      },
      {
        agentId: "sf-patterns",
        agentName: "Architecture Patterns Specialist",
        reason:
          "Large Data Volume patterns are essential given SAP order history volume; Well-Architected Framework review needed for integration resilience.",
        sfRisks: [
          "SOQL performance degradation on Order object with millions of records without proper indexing",
          "Skinny table or external object strategy needed for historical SAP order data",
          "Platform Event replay and subscriber error handling for MuleSoft event bus reliability",
        ],
        priority: "recommended",
      },
      {
        agentId: "sf-judge",
        agentName: "Architecture Review Judge",
        reason: "Final ARB verdict required for all review sessions.",
        sfRisks: [],
        priority: "required",
      },
      {
        agentId: "sf-scribe",
        agentName: "Architecture Scribe",
        reason: "ADR documentation required for all review sessions.",
        sfRisks: [],
        priority: "required",
      },
      {
        agentId: "sf-learner",
        agentName: "Session Learner",
        reason: "Session learning extraction required for all review sessions.",
        sfRisks: [],
        priority: "required",
      },
    ],
    sfConsiderations: [
      "Experience Cloud guest user sharing rules must be carefully scoped to prevent order data leakage across customers",
      "MuleSoft API Manager should handle rate limiting and circuit-breaking before calls reach Salesforce",
      "Einstein Bot licence cost and case deflection SLA targets must be agreed before build scope is finalised",
      "Deployment sequencing must respect Experience Cloud metadata dependencies — LWC bundles before site publish",
      "Performance baseline (SOQL, Apex CPU) must be captured in a Full sandbox before UAT with realistic data volumes",
    ],
  };
}

const MOCK_RESPONSES: Record<string, string> = {
  "sf-designer": `## Architecture Assessment
The request covers a Customer 360 self-service portal on Salesforce Experience Cloud, integrated with SAP S/4HANA via MuleSoft for real-time order data, and Einstein Bot-driven case deflection. The scope spans Sales Cloud (account/contact), Service Cloud (cases, bots), and Experience Cloud (portal), with an external integration layer. This is a multi-cloud, mid-to-high complexity initiative that requires careful data architecture and security model design before any sprint begins.

## Recommended Approach
1. **Single-org strategy** — keep all clouds in one production org to avoid cross-org data replication complexity. Use permission set groups to isolate Experience Cloud portal access.
2. **Data model** — create a custom \`SAPOrder__c\` object with a Master-Detail to Account. Do not replicate all SAP fields; bring only what is needed for the 360 view (status, line items, estimated delivery). Use External ID field \`SAP_Order_ID__c\` as the MuleSoft upsert key.
3. **Integration pattern** — MuleSoft publishes order updates to a Platform Event (\`OrderStatusChanged__e\`). An Apex subscriber triggers a queueable to update \`SAPOrder__c\` records. This decouples the integration layer from DML and avoids synchronous API timeout risk.
4. **Experience Cloud** — use an LWR (Lightning Web Runtime) site template for performance. Enforce authenticated user access for all order data pages. Guest profile must be locked down to public-facing case submission only.
5. **Security model** — create a custom OWD of Private on \`SAPOrder__c\`, then use Apex-managed sharing to grant access only to the Account's portal contacts. Do not rely on sharing rules for this — the Account hierarchy complexity makes criteria-based sharing unpredictable.

## Governor Limit Considerations
- **API call limits**: At 1,000 customers polling order status every 5 minutes, that is 288,000 API calls/day — well within Enterprise licence (1M/day), but monitor via Event Monitoring.
- **Platform Event limits**: 250,000 event publishes per 24 hours (Enterprise). Batch SAP updates into composite events where possible.
- **DML rows**: Queueable order update jobs must not exceed 10,000 DML rows per transaction. Chain queueables if bulk updates exceed this.
- **SOQL rows**: Order history queries must use indexed fields (Account ID, CreatedDate) with explicit \`LIMIT\` to avoid the 50,000 row governor.

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| Guest user sees other customer orders | Critical | Private OWD + Apex sharing on SAPOrder__c; security review before go-live |
| MuleSoft outage blocks order updates | High | Platform Event replay window (72 hrs); alerting on event backlog depth |
| Schema changes break MuleSoft mappings | High | Versioned MuleSoft API contracts; External ID as stable integration key |
| LWR site performance under load | Medium | Enable CDN caching for static assets; use wire adapters not imperative Apex calls |
| Einstein Bot licence overrun | Low | Set Bot session limits; monitor deflection rate vs. live-agent handoff ratio |`,

  "sf-lwc": `## LWC & Experience Cloud Assessment
The portal requires bespoke Lightning Web Components for order tracking, case submission, and bot handoff — all delivered on an Experience Cloud LWR site. The challenge is building components that work correctly for authenticated community users while locking down guest-accessible pages. LMS and cross-component communication patterns are critical to get right on Experience Cloud, where the standard import paths differ from internal Salesforce pages.

## Component Architecture
1. **\`c/orderTimeline\`** — fetches \`SAPOrder__c\` records via \`@wire(getRecord)\` scoped to the logged-in community user's Account. Renders a vertical timeline using SLDS utilities. Publishes \`ORDER_SELECTED\` on LMS when the user clicks a row.
2. **\`c/orderDetail\`** — subscribes to \`ORDER_SELECTED\` via LMS. Renders line items as a data table. Must use \`@salesforce/messageChannel\` import — available on LWR sites from API version 55+.
3. **\`c/caseSubmit\`** — Screen Flow embedded via \`lightning-flow\`. Pre-populates case subject from selected order via LMS message. Guest users access a stripped-down version of this component on the public contact page.
4. **\`c/botHandoff\`** — listens for Einstein Bot \`HANDOFF\` MIAW event and renders a spinner + estimated wait time. Uses \`lwc:ref\` to access the chat window DOM element for scroll control.

## Experience Cloud Specific Concerns
- All components must declare \`isExposed: true\` and define \`targets\` including \`lightningCommunity__Page\` in \`meta.xml\` to appear in Experience Builder.
- LWR sites do not support Aura components — confirm no legacy Aura dependencies exist in the org before build begins.
- CSS scoping on LWR uses Light DOM for Experience Cloud theme tokens. Do not use \`:host\` selectors for colour — use SLDS design tokens (\`--slds-c-button-*\`) so the site theme override propagates correctly.
- Guest user profile must have FLS read access on \`SAPOrder__c.Status__c\` and \`SAPOrder__c.EstimatedDelivery__c\` only — no other fields.

## SLDS & Theming
- Use \`lightning-card\`, \`lightning-badge\`, and \`lightning-icon\` from base components — do not build custom CSS equivalents.
- Order status badges should use semantic colour mapping via a JS getter that maps status strings to SLDS \`variant\` values (\`success\`, \`warning\`, \`error\`).
- Mobile responsiveness: use \`slds-grid slds-wrap\` with \`slds-size_1-of-1 slds-medium-size_1-of-2\` for the order list/detail split view.

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| LMS not available on older API version | High | Set API version 58+ in all component meta.xml files |
| Guest user LWC exposes order fields | Critical | Wire adapter scoped to \`communityId\` + server-side FLS enforcement in Apex controller |
| Component not showing in Experience Builder | Medium | Verify \`isExposed\` and \`targets\` in meta.xml; redeploy metadata |
| SLDS token overrides broken by site theme | Low | Test in Experience Builder preview with theme applied before UAT |`,

  "sf-apex": `## Apex & Integration Assessment
Three distinct Apex concerns arise: the Platform Event subscriber that processes MuleSoft order updates, the Einstein Bot handoff Apex action, and the Apex sharing recalculation logic for \`SAPOrder__c\`. Each has different transaction boundaries and governor limit profiles that must be designed separately.

## Platform Event Subscriber — Order Status Updates
\`\`\`apex
// Trigger on OrderStatusChanged__e — keep thin, hand off to queueable
trigger OrderStatusChangedTrigger on OrderStatusChanged__e (after insert) {
    List<OrderStatusChanged__e> events = Trigger.new;
    System.enqueueJob(new OrderStatusQueueable(events));
}
\`\`\`
The queueable processes up to 200 events per execution (Platform Event trigger batch size). It performs a single \`SELECT\` by \`SAP_Order_ID__c\` External ID, bulkifies the update DML, and chains a new queueable if the remaining list exceeds 200 items.

**Critical**: \`OrderStatusQueueable\` must implement \`Database.AllowsCallouts\` only if it makes HTTP calls — if it only does DML, omit the interface to avoid unnecessary platform overhead. Do not make callouts inside Platform Event triggers.

## Einstein Bot Handoff Apex Action
\`\`\`apex
@InvocableMethod(label='Transfer Bot Case to Queue')
public static List<String> transferToQueue(List<BotHandoffRequest> requests) {
    // Avoid Mixed DML: Case update (setup + non-setup) — use future method
    List<String> caseIds = new List<String>();
    for (BotHandoffRequest req : requests) {
        caseIds.add(req.caseId);
    }
    transferAsync(caseIds, requests[0].queueName);
    return new List<String>{'OK'};
}

@future
private static void transferAsync(List<String> caseIds, String queueName) {
    Group queue = [SELECT Id FROM Group WHERE DeveloperName = :queueName AND Type = 'Queue' LIMIT 1];
    List<Case> cases = [SELECT Id, OwnerId FROM Case WHERE Id IN :caseIds];
    for (Case c : cases) {
        c.OwnerId = queue.Id;
        c.Status = 'In Progress';
    }
    update cases;
}
\`\`\`
The \`@future\` method avoids the Mixed DML exception that occurs when an InvocableMethod triggered from a bot session (which runs in a setup-object context) attempts to update non-setup objects like Case directly.

## Apex Managed Sharing — SAPOrder__c
On each Account portal contact assignment, recalculate \`SAPOrder__Share\` records:
- Query all \`SAPOrder__c\` for the Account.
- Upsert \`SAPOrder__Share\` with \`AccessLevel = 'Read'\` for each portal contact user.
- Delete stale share records when a contact is deactivated.

Use a \`@future(callout=false)\` or Queueable for share recalculation to avoid the 200-row share insert limit in synchronous context.

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| Platform Event subscriber hitting CPU limit | High | Profile in sandbox with 1,000-event batch; offload heavy logic to queueable |
| Mixed DML in bot handoff action | High | Confirmed — use @future or Queueable for non-setup DML |
| Queueable chain depth exceeded (5 max) | Medium | Design order update processor to self-terminate if no remaining records |
| Share recalculation race condition | Medium | Use optimistic locking pattern; log share errors to custom object for retry |`,

  "sf-flow": `## Flow & Automation Assessment
Before committing to Apex for case routing and notification logic, declarative Flow should be evaluated. Two Flow automation opportunities are strong candidates: case deflection scoring and order status notification emails. Both are achievable declaratively with guardrails to avoid recursion.

## Case Deflection Routing Flow
**Type**: Screen Flow (invoked from Einstein Bot handoff decision point)

The bot calls a Screen Flow via Invocable Action when the customer's intent score drops below the deflection threshold. The Flow:
1. Queries open cases for the Account (using \`Get Records\` with a filter on Account ID and Status != 'Closed').
2. If an existing case matches the bot topic, routes to human agent via \`Apex Action: Transfer Bot Case to Queue\`.
3. If no match, creates a new Case with pre-populated fields from the bot session variables.
4. Sends a confirmation email via \`Send Email\` element using a Lightning Email Template.

**Recursion risk**: the Flow creates a Case, which could trigger a Record-Triggered Flow on Case creation. Add an entry condition \`{!$Record.Origin} Equals 'Chat'\` on any Case RTF to exclude bot-created cases from the RTF path.

## Order Status Notification — Scheduled Flow
**Type**: Scheduled Flow (runs daily at 06:00)

Queries \`SAPOrder__c\` records where \`Status__c = 'Delayed'\` AND \`NotificationSent__c = false\`. Sends a custom notification via the \`Custom Notification\` action and sets \`NotificationSent__c = true\`. This avoids an Apex batch job for what is fundamentally a query-and-notify pattern.

**Governor limit**: Scheduled Flows process up to 250,000 records per 24-hour window. If delayed orders could exceed this, split by region or use a date-range filter to scope the run.

## Record-Triggered Flow — Case SLA Escalation
**Type**: Record-Triggered Flow, After Save, on Case

Fires when \`Status__c\` changes to \`Escalated\`. Creates a Task for the assigned agent and posts a Chatter mention to the Case feed. No Apex needed.

**Anti-pattern to avoid**: Do not put SOQL inside a loop inside a Flow — use \`Get Records\` once before the loop element and reference the collection variable within the loop.

## What Should Remain in Apex
- Apex-managed sharing recalculation (platform API not available in Flow)
- Platform Event queueable subscriber (not triggerable from Flow)
- Bot handoff with Mixed DML guard (Flow cannot use @future)

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| Record-Triggered Flow infinite loop | High | Add entry condition checking prior field value; enable Loop Detection in org |
| Scheduled Flow batch limit exceeded | Medium | Add date-range filter; monitor via Flow Error Email alerts |
| Screen Flow session state lost on redirect | Medium | Use \`$Flow.FaultMessage\` + Fault connector on every element; log to custom error object |`,

  "sf-omni": `## OmniStudio Assessment
OmniStudio is not a primary build tool for this requirement — the portal is LWR-based and the case/order flows are standard Service Cloud patterns. However, if the org has an active OmniStudio licence (Health Cloud, Communications Cloud, or standalone), two specific integration points warrant evaluation.

## Applicable OmniStudio Use Cases

### DataRaptor — SAP Order Data Transformation
If MuleSoft passes raw SAP IDoc or BAPI payloads into Salesforce (rather than pre-mapped JSON), a DataRaptor Transform can normalise the payload to \`SAPOrder__c\` field mappings before the Platform Event fires. This keeps the transformation logic in configuration rather than Apex.

**Caution**: DataRaptors add a runtime licence consumption event per execution. At the order update volume projected (thousands per hour at peak), validate that your OmniStudio licence tier covers the execution volume before adopting this pattern.

### OmniScript — Case Submission Guided Flow
If the case submission form has conditional branching logic (e.g., different fields for billing vs. technical cases), an OmniScript provides a better low-code authoring experience than a Screen Flow for non-developer maintainers. The OmniScript embeds as a Lightning Web Component on the Experience Cloud page.

**Trade-off**: OmniScript adds a dependency on the OmniStudio managed package and increases deployment complexity. For a straightforward case form, a Screen Flow is the lower-complexity choice and should be preferred unless the business requires OmniStudio for other features.

## Recommendation
**Do not introduce OmniStudio for this project** unless it is already deployed in the org and actively used. The LWC + Flow + Apex combination delivers the same capability without the managed package dependency and licence overhead. If OmniStudio is later needed for an Industry Cloud extension (e.g., Communications Cloud CPQ), revisit this recommendation.

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| OmniStudio package upgrade breaking DataRaptors | High | Pin managed package version; test upgrades in sandbox first |
| DataRaptor volume exceeding licence tier | Medium | Benchmark execution count in sandbox before production rollout |
| OmniScript not rendering on LWR site | Medium | Verify OmniStudio LWR support in current package version (54+) |`,

  "sf-patterns": `## Architecture Patterns Assessment
Three Well-Architected Framework dimensions are elevated for this solution: reliability (MuleSoft integration resilience), performance efficiency (Large Data Volume on \`SAPOrder__c\`), and security (Experience Cloud sharing). Each requires a deliberate pattern decision before build.

## Large Data Volume — SAPOrder__c
If the org will accumulate more than 10 million \`SAPOrder__c\` records within 2 years, standard Salesforce object storage will degrade SOQL performance. Mitigation options in order of preference:

1. **Skinny Table** (recommended first): Request Salesforce Support to create a skinny table on \`SAPOrder__c\` for the fields used in portal queries (\`AccountId\`, \`Status__c\`, \`OrderDate__c\`). Zero development cost; dramatically reduces full-table scan time.
2. **External Object + Salesforce Connect**: If SAP is the system of record and order history beyond 90 days is rarely accessed, consider an External Object backed by a Salesforce Connect OData adapter against SAP. This keeps only recent orders in Salesforce and queries SAP for history on demand.
3. **Archiving strategy**: Implement a yearly archival job that moves closed orders to a custom archive object or external storage, retaining only a summary record in Salesforce.

## Integration Resilience — Platform Events
Platform Events provide a 72-hour replay window. The integration architecture should treat this as a recovery mechanism, not a normal operating mode:
- MuleSoft must implement idempotent publish — use the SAP Order ID as the correlation key to detect and discard duplicate events.
- The Apex subscriber must handle \`EventBus.RetryableException\` to signal Salesforce to redeliver a failed event batch (up to 9 retries).
- Implement a dead-letter pattern: after max retries, write the failed payload to a \`IntegrationError__c\` record with the raw JSON for manual inspection.

## Security Pattern — Zero-Trust Portal Access
Adopt a zero-trust posture for Experience Cloud:
- All Apex controllers serving portal users must use \`with sharing\` — never \`without sharing\`.
- CRUD and FLS must be enforced in every Apex method using \`Schema.sObjectType.SAPOrder__c.isAccessible()\` checks before SOQL.
- Guest profile: lock to minimum required objects and fields. Run the Salesforce Security Health Check monthly in production.
- Enable Shield Platform Encryption on \`SAPOrder__c\` fields containing PII (e.g., delivery address) if the org is Shield-licenced.

## Salesforce Well-Architected Score Projection
| Dimension | Current Risk | Target State |
|-----------|-------------|--------------|
| Reliability | High (no retry/dead-letter) | Medium (Platform Event retry + dead-letter) |
| Performance | High (LDV without skinny table) | Low (skinny table + indexed queries) |
| Security | High (sharing not designed) | Low (zero-trust + Shield encryption) |
| Operational Excellence | Medium (no monitoring) | Low (Event Monitoring + Health Check) |

## Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| SOQL timeout on order history at 10M+ records | High | Skinny table request + mandatory LIMIT on all order queries |
| Duplicate Platform Events corrupting order state | High | Idempotency key check in Apex subscriber before DML |
| Security Health Check score degrading post-launch | Medium | Monthly automated Health Check report via Salesforce CLI |`,

  "sf-judge": `## ARB Verdict

**Decision: APPROVE WITH CONDITIONS**

## Summary of Findings
Specialist agents identified a sound overall architecture — single-org, Platform Event-driven integration, LWR Experience Cloud — with several implementation risks that must be resolved before the first sprint begins. The most critical gaps are in the sharing model for \`SAPOrder__c\` (where a misconfiguration could expose order data across customers) and the absence of a Large Data Volume strategy for a dataset projected to reach tens of millions of records. The Apex patterns for Platform Event processing and bot handoff are correctly identified; the Mixed DML mitigation for Einstein Bot handoff is mandatory.

## Critical Issues (Must Fix)
1. **Sharing model design must be documented and reviewed before any data model deployment.** Apex-managed sharing on \`SAPOrder__c\` with Private OWD is the correct pattern, but the sharing recalculation trigger points (contact assignment, deactivation, Account merge) must be fully enumerated and tested in a sandbox with realistic user counts.
2. **LDV strategy decision required before schema deployment.** If projected \`SAPOrder__c\` volume exceeds 5 million records within 18 months, submit a Salesforce Support skinny table request before go-live. Deploying the schema without this decision locks the team into a performance remediation later.
3. **Platform Event dead-letter pattern must be implemented.** The integration architecture has no recovery path for failed Apex subscriber executions beyond the 9-retry window. \`IntegrationError__c\` dead-letter records are mandatory before the MuleSoft integration goes live.
4. **Guest profile lockdown must be verified by a Salesforce-certified security review** (internal or external) before the Experience Cloud site is made public. Automated Health Check alone is insufficient for a customer-facing portal.

## Conditions (Approved with Conditions)
1. Deliver a **Sharing Architecture Decision Record** (ADR-001) covering \`SAPOrder__c\` OWD, Apex sharing logic, and Experience Cloud guest profile field access — reviewed by this ARB before data model deployment.
2. Complete a **Data Volume Assessment** projecting \`SAPOrder__c\` row counts at 6, 12, and 24 months. Submit skinny table request if any projection exceeds 5M rows.
3. Implement \`IntegrationError__c\` dead-letter object and Apex retry logic for Platform Event subscriber failures — required for MuleSoft integration UAT sign-off.
4. Execute **Salesforce Security Health Check** in Full sandbox (with production-equivalent data) and resolve any Critical or High findings before UAT.

## Recommendations (Non-blocking)
1. Evaluate Salesforce Connect External Object for SAP historical order data (>90 days) to reduce long-term Salesforce storage costs.
2. Add Event Monitoring for Experience Cloud page views and Apex execution logs — baseline performance data is invaluable for post-launch optimisation.
3. Pin the OmniStudio managed package version if any DataRaptor transforms are introduced — upgrade testing is a hidden maintenance cost.
4. Define a bot deflection rate KPI (target: ≥40% deflection) and instrument Einstein Bot analytics before launch to validate ROI.

## Risk Score
| Dimension | Score (1-5) | Rationale |
|-----------|-------------|-----------|
| Technical Debt | 2 | Clean patterns chosen; risk is in sharing recalculation completeness |
| Security | 4 | Guest user sharing is unproven until tested; guest profile not yet scoped |
| Scalability | 3 | LDV strategy pending; Platform Event volume within limits today |
| Maintainability | 2 | Declarative-first approach with Flow + LWC; Apex surface is small |`,

  "sf-scribe": `## Architecture Decision Record — Customer 360 Portal

**ADR-2024-001 | Status: APPROVED WITH CONDITIONS | Date: ${new Date().toISOString().split("T")[0]}**

---

### Context
Telco client requires a self-service Customer 360 portal for B2C customers to view real-time SAP order status, submit service cases, and receive Einstein Bot-assisted case deflection. The platform decision is Salesforce Experience Cloud (LWR) integrated with SAP S/4HANA via MuleSoft Anypoint.

### Architectural Decisions

**Decision 1: Single-Org Strategy**
All three clouds (Sales, Service, Experience) will be implemented in a single Salesforce production org. Rejected: multi-org with cross-org API calls (increases latency and adds integration complexity without benefit at current scale).

**Decision 2: Platform Event Integration Pattern**
MuleSoft will publish \`OrderStatusChanged__e\` Platform Events. Rejected: synchronous REST callout from MuleSoft to Salesforce (timeout risk at high volume; no retry mechanism). Accepted: async Platform Event with 72-hour replay window and dead-letter via \`IntegrationError__c\`.

**Decision 3: Apex-Managed Sharing on SAPOrder__c**
OWD set to Private. Apex sharing grants Read access to portal contacts linked to the record's Account. Rejected: criteria-based sharing rules (insufficient flexibility for Account hierarchy complexity); Guest profile FLS only (does not protect at record level).

**Decision 4: LWR Site Template**
Experience Cloud site uses Lightning Web Runtime (LWR). Rejected: Aura-based template (deprecated path; no new feature investment from Salesforce). Custom LWC components declared with \`lightningCommunity__Page\` target.

**Decision 5: Declarative-First Automation**
Case submission and routing implemented in Screen Flow + Record-Triggered Flow. Apex used only for: Platform Event subscriber, Apex-managed sharing, bot handoff (Mixed DML guard). Rejected: full Apex automation (increases maintenance burden; Flow is sufficient for routing logic).

### Constraints & Assumptions
- Salesforce Enterprise licence with Experience Cloud and Einstein Bots add-on confirmed.
- MuleSoft Anypoint Platform is available and the integration team will own the SAP connector.
- \`SAPOrder__c\` volume projection: 2M records at launch, growing to 8M within 24 months (skinny table request required before launch).
- No OmniStudio licence — OmniScript and DataRaptors are out of scope for this implementation.

### Open Questions (Owner | Due Date)
1. Shield Platform Encryption requirement for delivery address fields — Security team | Sprint 1
2. Skinny table request submission — Architecture lead | Before Sprint 2 data model deploy
3. Bot deflection KPI targets — Product owner | Before Einstein Bot configuration sprint

### Consequences
- **Positive**: Clean separation of concerns; declarative automation reduces Apex surface; Platform Event pattern supports future MuleSoft expansion.
- **Negative**: Apex-managed sharing adds complexity to user provisioning flows that must be maintained as contact/account relationships change.
- **Risk accepted**: LDV risk is known and mitigated by the skinny table pre-condition; if skinny table is not approved by Salesforce Support before launch, go-live must be delayed.

### Sign-off
| Role | Name | Status |
|------|------|--------|
| ARB Judge | Architecture Review Board | APPROVED WITH CONDITIONS |
| Solution Architect | TBD | Pending |
| Security Lead | TBD | Pending |
| Integration Lead | TBD | Pending |`,

  "sf-learner": `## Session Learnings — Customer 360 Portal ARB

**Session ID**: ARB-2024-001 | **Domain**: Salesforce | **Outcome**: APPROVED WITH CONDITIONS

---

### Key Learnings Extracted

**L1 — Sharing model design must precede schema deployment**
The session identified that deploying \`SAPOrder__c\` without a finalised sharing architecture creates a remediation risk. For future sessions: any custom object storing customer-owned data (orders, cases, contracts) in a B2C portal context must have its sharing model ADR approved before the first metadata deployment sprint.

**L2 — Platform Event dead-letter is non-negotiable for production integrations**
The absence of a dead-letter recovery mechanism was flagged as a Critical Issue. Pattern to reuse: \`IntegrationError__c\` object with fields for payload (Long Text), event type, retry count, and resolved flag. Include this in the standard integration starter template for all future MuleSoft ↔ Salesforce Platform Event designs.

**L3 — Mixed DML in Einstein Bot Apex actions requires @future**
Einstein Bot Invocable Actions run in a setup-object transaction context. Any non-setup DML (Case, Contact, Custom Object) inside an InvocableMethod will throw a Mixed DML exception unless deferred via \`@future\` or \`Queueable\`. Flag this pattern in the org's Apex coding standards documentation.

**L4 — LWR Experience Cloud sites do not support Aura components**
Confirmed at design time — if any Aura components exist in the org for reuse, they must be rewritten as LWC before inclusion in an LWR site. This discovery late in a project creates sprint disruption; add an Aura dependency audit to the Experience Cloud project initiation checklist.

**L5 — LDV decision point is 5M records / 18-month projection**
Adopted as a rule of thumb for this ARB: any custom object projected to exceed 5 million records within 18 months of launch requires a skinny table request and mandatory indexed-field query enforcement before go-live.

### Patterns to Promote to Org Playbook
- Platform Event + Queueable subscriber pattern (idempotent, dead-letter, retry)
- Apex-managed sharing template for B2C Experience Cloud objects
- Screen Flow embedded in LWC for guided case submission
- Zero-trust Apex controller pattern (with sharing + FLS checks on every controller method)

### Risks to Watch Post-Launch
- Monitor \`SAPOrder__c\` row count monthly — escalate skinny table review if approaching 4M rows
- Review Einstein Bot deflection rate at 30-day and 90-day post-launch milestones
- Run Salesforce Security Health Check monthly in production; log results to the ARB risk register`,
};

export function getMockResponse(agentId: string): string {
  return (
    MOCK_RESPONSES[agentId] ??
    `## Mock Response — ${agentId}\n\nThis agent does not have a pre-written mock response. In live mode, Claude would generate a detailed Salesforce architecture review here.\n\n**Agent ID**: ${agentId}\n**Mode**: Mock (ANTHROPIC_API_KEY not set)`
  );
}
