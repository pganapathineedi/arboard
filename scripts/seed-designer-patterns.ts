/**
 * Seed DSGN-001 to DSGN-008 (Solution Designer failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:designer-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const designerFailurePatterns = [
  {
    id: "DSGN-001",
    title: "Custom Apex trigger written for a requirement that declarative Flow could meet — unnecessary code debt introduced at design",
    scenario:
      "A Solution Design Document (SDD) specifies an Apex trigger on the Opportunity object to set a default close date of 30 days from today on every new Opportunity where the close date is blank. The developer implements this as a before-insert Apex trigger with a handler class, a test class, and a deployment package. The trigger is deployed, passes QA, and goes live. Six months later, the business changes the default to 45 days. The change requires a developer, a code change, a test run, a sandbox deployment, a production deployment window, and a change management record. The same logic expressed as a Flow record-triggered flow with a formula assignment — `TODAY() + 30` — would have taken 20 minutes to build, required no code review, and could be updated by an administrator in under 5 minutes without a deployment window. The solution architect approved the Apex design without evaluating the declarative alternative. The SDD contains no evidence that Flow was considered and rejected. Over the project, 12 similar patterns are implemented in Apex where Flow would have sufficed, creating a codebase that no business administrator can maintain.",
    better_path:
      "Every SDD must include a solution fit assessment before proposing custom code. For any automation requirement, evaluate in order: (1) standard Salesforce feature (default field values, record types), (2) declarative automation (Flow, validation rules, formula fields, approval processes), (3) low-code configuration (custom metadata, OmniStudio), (4) custom Apex. Document in the SDD which options were evaluated and why each declarative option was insufficient. A requirement that Flow can meet in 30 minutes has no justification for Apex. If Apex is chosen, state specifically what declarative tools cannot do: 'Flow cannot perform a callout to validate the close date against the ERP calendar — Apex HTTP callout required.' The Salesforce Well-Architected Easy pillar defines Simple and Automated as core design values — the simplest solution that meets the requirement is architecturally correct.",
    severity: "medium",
    components: ["Architecture", "Flow", "Apex", "Technical Debt"],
    tags: ["designer", "declarative", "flow", "apex", "technical-debt", "solution-fit", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-002",
    title: "No scalability assessment for a high-volume object — SOQL timeouts and storage cost spiral emerge in year two",
    scenario:
      "An SDD designs a Service Log custom object to capture every customer interaction event from a contact centre. The design documents the object's fields and relationships but includes no volume projection. The architect estimates 'a few thousand records' verbally in the design workshop but this is not documented. In production, the contact centre handles 8,000 interactions per day. After 18 months, the Service Log object holds 4.3 million records. SOQL queries in the case management dashboard — which were designed without selectivity analysis — start timing out intermittently under concurrent load. The dashboard uses `WHERE Status__c = 'Open'` on a non-indexed field on a 4M-record object, causing a full table scan. Storage costs triple the projected budget. A report that filtered by date range and status worked fine at 50,000 records but now returns a Salesforce timeout error. The redesign to add a custom index requires a Salesforce Support case and a 3-week lead time. The archival strategy, absent from the original design, must now be retrofitted in production with active data.",
    better_path:
      "Volume projections are a mandatory design input, not an afterthought. For every custom object in the SDD, document: current estimated record count at go-live, projected growth rate per month, and projected total at year 1, year 3, and peak load. Any object projected to exceed 1 million records is a Large Data Volume (LDV) object and requires an explicit indexing strategy (custom index request via Salesforce Support), an archival strategy (Big Objects, native archival, or third-party), and a SOQL selectivity analysis for every query pattern the object will support. Selective queries return <10% of total records using an indexed field filter. Document the query patterns and confirm selectivity in the SDD before build. Engage Salesforce Support for custom index provisioning during the build phase — lead time is typically 2–4 weeks and cannot be rushed at go-live.",
    severity: "high",
    components: ["Architecture", "Data Volume", "Scalability"],
    tags: ["designer", "scalability", "LDV", "data-volume", "indexing", "archival", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-003",
    title: "Integration error strategy absent from SDD — silent data loss occurs on any external system failure",
    scenario:
      "An SDD describes a real-time integration between Salesforce and a downstream ERP system: when an Order is created in Salesforce, a Platform Event fires and an external middleware consumer posts the Order data to the ERP. The SDD documents the happy-path data flow with a sequence diagram showing the event publication and ERP confirmation. It does not document what happens when the ERP is unavailable, when the middleware returns a 503, when the order payload fails ERP validation, or when the Platform Event is published but the consumer is offline beyond the 72-hour retention window. In production during a scheduled ERP maintenance window, 340 Orders are created in Salesforce. All 340 Platform Events are published. The ERP consumer is offline. The events expire after 72 hours — none of them are redelivered. 340 Orders exist in Salesforce with no corresponding ERP record. The discrepancy is discovered 6 days later during a financial reconciliation. The remediation requires a manual extract, ERP batch import, and a 3-day investigation to confirm no additional gaps.",
    better_path:
      "Every integration in the SDD must define a complete error strategy alongside the happy path. The error strategy must cover: (1) retry — how many attempts, with what backoff interval, for which HTTP status codes; (2) idempotency — how a retried operation avoids creating duplicates in the target system; (3) dead-letter handling — where failed records are written when retries are exhausted (a Salesforce custom object, an SQS dead-letter queue, a monitoring alert); (4) alerting — who is notified when failures breach a threshold, and within what SLA; (5) reconciliation — how the systems confirm they are in sync after a gap, and at what frequency. For Platform Event consumers, design a gap-fill mechanism: a scheduled reconciliation job that queries Salesforce for records in a 'pending sync' status and replays them if the ERP confirms it has no corresponding record. The Salesforce Well-Architected Trusted pillar requires that integrations are Reliable — reliability is impossible without a defined failure and recovery strategy.",
    severity: "critical",
    components: ["Architecture", "Integration", "Error Handling"],
    tags: ["designer", "integration", "error-strategy", "retry", "dead-letter", "reliability", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-004",
    title: "Org strategy not documented in SDD — integration design assumes single-org topology that does not match the client's landscape",
    scenario:
      "A global manufacturing client has three Salesforce orgs inherited from acquisitions: a US Sales org, an APAC Service org, and a Marketing org used for campaign management. The solution architect designs a customer 360 dashboard that aggregates account data, case history, and campaign engagement for each customer. The SDD describes the data model and UI but does not document the org topology. The development team builds the solution in the US Sales org, assuming that Account, Case, and Campaign records are all in a single org. When the solution reaches UAT, the APAC Service team reports that their cases are in a different org and do not appear in the dashboard. Pulling Case records from the APAC org requires a cross-org REST API call — an architectural concern that was never designed. The campaign data requires a third integration to the Marketing org. The solution must be redesigned to add two integration streams, two sets of Named Credentials, cross-org error handling, and data refresh scheduling. The redesign delays go-live by 8 weeks.",
    better_path:
      "The org strategy must be documented as the first architectural decision in every SDD, before any design work begins. The org strategy section must answer: How many Salesforce orgs are in scope? What data lives in each org? Which org is the system of record for each entity type (Account, Contact, Case, etc.)? How do users access data across orgs — is there SSO? For any cross-org data access, document the integration pattern (REST API, Platform Events, MuleSoft, Salesforce Connect), the data ownership and latency requirements, the authentication mechanism, and the failure mode. If the org strategy is unknown at design time, raise it as a MUST-RESOLVE blocker before architecture sign-off. A solution designed without org topology awareness will require redesign when the topology is discovered — and it is always discovered, at the worst possible time.",
    severity: "critical",
    components: ["Architecture", "Org Strategy", "Multi-Org"],
    tags: ["designer", "org-strategy", "multi-org", "architecture", "topology", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-005",
    title: "Solution designed without sharing model consideration — default OWD exposes regulated data to all internal users",
    scenario:
      "A financial services firm implements Salesforce to manage client portfolios. The SDD designs a Portfolio custom object with a Master-Detail relationship to Account. The SDD documents the fields, the UI, and the Apex service layer. The sharing model section states 'OWD: Public Read/Write — to be reviewed.' The review never happens. The object ships with Public Read/Write OWD. Six months after go-live, an internal audit discovers that every Salesforce user — including the 200-person call centre team — can read and edit the portfolio records of every client in the org, including portfolio value, investment strategy, and personal financial statements. The intended access model requires that relationship managers can only see their own clients' portfolios, and operations staff can see all portfolios in read-only mode. The retrofit requires: changing OWD to Private, designing and deploying role hierarchy (which the org currently has as a flat structure), building Apex Sharing rules for cross-team visibility, and running a sharing recalculation job — which takes 4 hours on the now-populated org. Three weeks of remediation work to fix a design decision that should have taken 30 minutes to make correctly.",
    better_path:
      "The sharing model is a data architecture concern and must be designed before any object or field is built. For every key object in the SDD, document: the OWD setting (Private, Public Read Only, Public Read/Write, Controlled by Parent), the role hierarchy access pattern, any sharing rules required (criteria-based or ownership-based), and any Apex Sharing requirements for complex access patterns. For objects that contain PII, financial data, or regulated information, the default assumption is Private OWD unless there is a documented business requirement for broader access. Identify the most restrictive access pattern first and document exceptions, not the reverse. For LDV objects, assess the performance impact of the chosen sharing model — criteria-based sharing rules on objects with >500k records require load testing before go-live. Present the sharing model to the client's security and compliance stakeholders for sign-off before build.",
    severity: "critical",
    components: ["Architecture", "Sharing Model", "Security"],
    tags: ["designer", "sharing-model", "OWD", "security", "compliance", "access-control", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-006",
    title: "No data retention or archival strategy for append-only objects — storage cost spirals and query performance degrades within 12 months",
    scenario:
      "An SDD designs an Activity Log custom object to capture every significant user action in a regulatory-compliance context: every time a record is viewed, edited, or approved, a new Activity Log record is created. The SDD documents the object, its fields, and the trigger that creates records. No section addresses data retention, archival, or deletion. The system goes live. After 6 months with 500 active users each generating an average of 20 log records per day, the Activity Log object holds 18 million records. After 12 months it holds 36 million records. Storage costs exceed the org's allocation, triggering overage charges. A compliance report that queries Activity Log records by date range — a query that worked in 3 seconds at go-live — now takes 45 seconds and intermittently times out. The compliance team cannot generate the reports required for their regulatory submission. The fix requires a Salesforce Big Object migration for historical records, a batch archival job design, a custom index request with a 3-week Salesforce Support lead time, and a storage cleanup — all retrofitted in a live production environment with active regulatory users.",
    better_path:
      "Every append-only or time-series object in the SDD — audit logs, event records, activity tracking, history tables — must have a data retention and archival strategy documented before build. The strategy must specify: the regulatory retention period for the data (how long must it be kept?), the access pattern during retention (must it be queryable in Salesforce reports, or is read-only access to raw data sufficient?), and the archival mechanism after the retention period (Big Objects for low-cost retention with limited query access, native Salesforce archiving, third-party tool, external data lake). For objects projected to exceed 1M records, the archival strategy must also specify the archival cadence (monthly batch, triggered at a threshold) and the technical mechanism. Big Objects are the correct Salesforce-native choice for compliance audit logs — they store data at low cost, are immutable (append-only by design), and meet regulatory retention requirements. Design the archival batch job in parallel with the object, not 12 months after go-live.",
    severity: "high",
    components: ["Architecture", "Data Retention", "Archival"],
    tags: ["designer", "data-retention", "archival", "big-object", "LDV", "compliance", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-007",
    title: "Technical debt not quantified or disclosed in SDD — accepted shortcuts surface as production incidents without a remediation plan",
    scenario:
      "Under delivery time pressure, a solution architect makes several design compromises: hardcoded Custom Metadata record IDs are used instead of a dynamic lookup because the metadata framework takes an extra week to build; a single 800-line Apex class handles three distinct business domains because decomposing it was 'not in scope'; a Flow is used for a synchronous integration callout even though it blocks the UI for 8 seconds because building an Apex async pattern was scheduled for phase 2; and an OWD change is deferred because the sharing recalculation job has not been performance-tested. Each of these compromises is verbally acknowledged in architecture workshops but none appears in the SDD. There is no technical debt register, no remediation plan, and no timeline. Over the next 6 months, the hardcoded IDs break on a sandbox refresh, the monolithic Apex class becomes unmaintainable as three different teams attempt to extend it simultaneously, the Flow callout causes user-reported timeout errors under load, and the deferred OWD change is forgotten entirely. Each issue surfaces as a production incident that requires emergency work, diverting the development team from planned feature delivery.",
    better_path:
      "Every design decision made under time or resource constraints that introduces known risk must be documented in the SDD's Technical Debt section. Each entry must include: the decision taken and the shortcut accepted, the known risk and the specific scenario in which it will surface, an estimated remediation effort in story points or days, a target sprint or release for remediation, and the name of the architect or lead who accepted the risk. Technical debt that is not documented is not managed — it is hidden. A client or delivery manager who is not informed of accepted debt cannot make an informed decision about scope or timeline. The Technical Debt section should be reviewed at every sprint review until all items are resolved. Debt accepted for phase 1 that is not scheduled for phase 2 is not debt — it is a defect waiting to happen. The Salesforce Well-Architected Adaptable pillar requires that solutions are Resilient — resilience is impossible when known risks are hidden.",
    severity: "high",
    components: ["Architecture", "Technical Debt", "Governance"],
    tags: ["designer", "technical-debt", "governance", "architecture", "risk", "sf-designer"],
    source: "sf-designer",
  },
  {
    id: "DSGN-008",
    title: "Solution designed for current state with no extensibility assessment — next anticipated requirement requires full redesign",
    scenario:
      "A retail client implements a Salesforce quoting solution for their current product catalogue of 50 SKUs, sold through a single sales channel (direct). The SDD documents the quoting data model, the pricing rules, and the approval workflow. The solution is built tightly around the single-channel, 50-SKU model: a custom Apex pricing engine with the channel logic hard-wired as conditional branches in the code, a quote line item model that assumes a flat product hierarchy with no configuration, and an approval process with the approver roles embedded in the process definition. Eighteen months after go-live, the client acquires a partner channel and adds 200 new configurable products with variant hierarchies. Every element of the quoting solution requires redesign: the Apex pricing engine needs a configurable rules framework to support channel-specific pricing, the quote line item model needs a parent-child structure for product variants, and the approval process needs a dynamic approver model based on channel and deal size. The redesign cost exceeds the original build cost. The original architect acknowledged in the design workshop that partner channels and configurable products were 'on the roadmap' but designed only for the current state.",
    better_path:
      "Every SDD must include a future-state extensibility assessment that explicitly identifies the anticipated next requirements and evaluates whether the proposed design can accommodate them without fundamental redesign. The assessment does not require building for the future — it requires confirming that the architecture does not foreclose on it. For the quoting example, this means: pricing logic should use a rules engine pattern (Custom Metadata-driven rules evaluated at runtime) rather than hard-wired conditionals — adding a new channel means adding a metadata record, not changing code; the quote line item model should use a hierarchical structure from the start — adding product variants means using the existing parent-child relationship, not schema changes; the approval process should use dynamic approver assignment based on record fields — adding channels means adding field values, not rebuilding the process. The Salesforce Well-Architected Adaptable pillar requires that solutions are Composable and Scalable — composability means future requirements add to the design, not replace it.",
    severity: "high",
    components: ["Architecture", "Extensibility", "Future State"],
    tags: ["designer", "extensibility", "future-state", "scalability", "composable", "adaptable", "sf-designer"],
    source: "sf-designer",
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(text: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY env var is required");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-code-3", input_type: "document" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[seed-designer-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-designer-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of designerFailurePatterns) {
    const { error } = await sb
      .from("failure_patterns")
      .upsert(pattern, { onConflict: "id" });

    if (error) {
      console.error(`  [failure_patterns] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [failure_patterns] Upserted ${pattern.id}`);
      patternCount++;
    }
  }

  // Step 2: embed and upsert into grounding_embeddings
  let embeddingCount = 0;
  for (const pattern of designerFailurePatterns) {
    const combinedText = `${pattern.title}\n\n${pattern.scenario}\n\n${pattern.better_path}`;

    console.log(`  [grounding_embeddings] Embedding ${pattern.id}…`);
    const embedding = await embedText(combinedText);

    const { error } = await sb.from("grounding_embeddings").upsert(
      {
        source_id: pattern.id,
        content_type: "failure_pattern",
        chunk_text: combinedText,
        metadata: {
          domain: "salesforce",
          chunk_index: 0,
          agent_hints: ["sf-designer"],
          tags: pattern.tags,
        },
        embedding,
      },
      { onConflict: "source_id" }
    );

    if (error) {
      console.error(`  [grounding_embeddings] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [grounding_embeddings] Upserted ${pattern.id}`);
      embeddingCount++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(
    `\nSeeded ${patternCount} failure patterns to failure_patterns, ${embeddingCount} embeddings to grounding_embeddings`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
