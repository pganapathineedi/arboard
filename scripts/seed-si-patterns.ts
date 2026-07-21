/**
 * Seed SI-001 to SI-008 (cross-domain SI delivery failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:si-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const siFailurePatterns = [
  {
    id: "SI-001",
    title: "Mixed automation stack — Workflow Rules, Process Builder, and Flow all active on the same object — cascading governor limit failure on bulk DML",
    scenario:
      "An Opportunity object has accumulated automation across three delivery phases: Phase 1 added a Workflow Rule that sends a field update setting Stage_Updated__c to true on every stage change; Phase 2 added a Process Builder process that creates a follow-up Task on every close date change; Phase 3 added a record-triggered After Save Flow that updates the related Account's Last_Opportunity_Date__c and creates a Notification__c record. All three automations are active simultaneously and none of the implementing teams documented the others. In normal single-record operation, all three run and the overall behaviour appears correct. When the sales operations team runs a quarterly data clean-up that updates 500 Opportunity records via Data Loader, the combined automation stack fires: the Workflow Rule field update re-triggers the before trigger and the after trigger (Workflow field updates cause a second pass through triggers), the Process Builder creates one Task per record (150 DML statements for the first 150 records), and the Flow executes additional DML for Account updates and Notification records. The combined DML statement count across all automations within the 200-record transaction batch exceeds 150 — 'Too many DML statements: 151' is thrown at the 151st combined DML operation. The entire batch rolls back. None of the 500 Opportunity updates succeed. The data clean-up team retries multiple times with smaller batches and escalates to the development team, who require 3 hours to diagnose the root cause by reading the order of execution documentation and mapping all active automations.",
    better_path:
      "Maintain an Automation Registry — a documented inventory of every active automation (Trigger, Flow, Process Builder, Workflow Rule) per object, the fields each automation writes to, the DML operations it performs, and the business owner who approved it. Before deploying any new automation on an object, the Automation Registry must be reviewed and updated. The registry review is a mandatory checklist item in the definition of done for every automation-related user story. When the registry reveals overlap or the DML stack analysis shows risk, consolidate: migrate all Process Builder processes and Workflow Rules on the object to a single record-triggered Flow; the Flow becomes the single automation owner. Run a combined governor limit analysis for every object with multiple active automations: model the peak transaction (200-record bulk DML) and sum the SOQL queries, DML statements, and CPU time consumed by all automations combined. If the combined total for any limit exceeds 50% of the platform limit at 200 records, redesign before go-live.",
    severity: "critical",
    components: ["Flow", "Apex", "Automation", "Governor Limits"],
    tags: ["si-patterns", "automation-stack", "governor-limits", "workflow-rules", "process-builder", "flow", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-002",
    title: "Integration contract undocumented — API schema drift breaks callouts silently after external system upgrade",
    scenario:
      "A custom Apex integration calls an external ERP system's REST API to retrieve product pricing data. The integration was built by reverse-engineering the ERP's API responses during development — no OpenAPI specification was obtained from the ERP team, and no contract document was created. The Apex class deserialises the response into a custom Apex wrapper class with fields mapped by name. Eighteen months after go-live, the ERP vendor releases a major version upgrade. The new API version renames the `unit_price` field to `unitPrice` (camelCase instead of snake_case) and adds a new required request parameter `currency_code`. The Salesforce integration sends requests without `currency_code` — the new ERP API returns a 400 Bad Request for every pricing call. The Apex deserialisation class still compiles because the missing `unit_price` field simply resolves to null rather than throwing an exception. In production, all product pricing displays as zero. No alert fires because the callout succeeds with HTTP 400 (the retry logic only retries on 5xx). Business users see £0.00 pricing on all quotes for 3 days before anyone reports it. The ERP upgrade was scheduled and communicated by the vendor — but the Salesforce team was not on the notification list because no integration contract existed to identify them as a consumer.",
    better_path:
      "Every integration must be governed by a documented API contract: an OpenAPI 3.0 specification (or WSDL for SOAP) stored in the repository and reviewed as part of the integration design. The contract documents the endpoint, version, authentication method, request schema, response schema, and error codes. Establish a schema change notification process with the external API owner — include the Salesforce integration team in the vendor's API change mailing list. When the external API is versioned, pin the registered External Service or Named Credential to a specific version and do not upgrade without a coordinated migration sprint. Implement response schema validation in Apex: if a required field (`unit_price`) resolves to null in the deserialised response, treat it as an integration failure rather than a valid zero-price result. Add a contract compliance test in the CI pipeline that validates the expected response structure against the stored OpenAPI spec using a mock server.",
    severity: "high",
    components: ["Integration", "Apex", "API Contract"],
    tags: ["si-patterns", "integration-contract", "schema-drift", "openapi", "versioning", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-003",
    title: "Silent failure in async Queueable — financial transaction lost with no log, no alert, no retry",
    scenario:
      "A payment processing workflow triggers a Queueable job that calls an external payment gateway to charge a customer's stored payment method. The Queueable's execute() method has no try/catch block — the developer assumed the payment gateway was reliable and that Apex exceptions in Queueable jobs would appear in the Apex Jobs logs. In production, the payment gateway returns an intermittent 503 Service Unavailable during a high-traffic period. The HTTP callout in the Queueable throws a `System.CalloutException: Read timeout'. Because there is no try/catch, the exception propagates to the Queueable framework. The Queueable job is marked as 'Failed' in the Apex Jobs list. The failed job has an error message of 'System.CalloutException: Read timeout' — visible only to a System Administrator looking at the Apex Jobs UI, which no one monitors in real time. The customer's account shows 'Payment Pending' indefinitely. No retry is attempted. No error log record is created. No alert is sent to the operations team. No Platform Event is published. The payment is never collected. The finance team discovers the gap during a monthly reconciliation when the customer's invoice shows unpaid. By that time, 23 similar failures have accumulated over 4 weeks — all silent, all unrecoverable.",
    better_path:
      "Every async execution context (Queueable, Batch execute(), @future, Platform Event subscriber) must wrap its entire body in a try/catch block. The catch block must: (1) create a durable error log record (custom Error_Log__c object with fields for job type, record ID, error class, error message, stack trace, and timestamp); (2) publish a Platform Event to an operational alerting subscriber that notifies the operations team in near-real-time; (3) for recoverable errors (5xx, timeout, rate limit), implement exponential backoff retry by enqueuing a new Queueable with a retry count parameter — maximum 3 retries; (4) for non-recoverable errors (4xx, permanent gateway rejection), write the payment record to a 'Failed_Payments__c' object with the reason, so the finance team has a queryable audit trail. The Apex Jobs UI is not a monitoring tool — it is a diagnostic tool. Production monitoring must be event-driven: publish an event when something fails, not check a UI periodically.",
    severity: "critical",
    components: ["Apex", "Queueable", "Integration", "Error Handling"],
    tags: ["si-patterns", "silent-failure", "queueable", "async", "error-handling", "logging", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-004",
    title: "Hardcoded environment configuration — org-specific IDs and endpoint URLs block environment promotion and break at deployment",
    scenario:
      "A solution deploys across four environments: Developer, SIT, UAT, and Production. Across the codebase, configuration values are hardcoded directly in Apex classes and Flow formulas: a queue ID (`00G1n000000xxxXXX`) is hardcoded in a case routing Apex class; a profile ID (`00e1n000001xxxXXX`) is referenced in a user creation utility; an API endpoint URL (`https://erp-uat.acme.com/api/v2/pricing`) is hardcoded in a Named Credential override in a test utility class; and a specific user's ID is hardcoded as the default approver in a Flow formula. Each of these values is valid in the environment where it was created. When the solution is deployed from SIT to UAT, the queue and profile IDs are invalid in the UAT org — the same logical queues and profiles exist but with different record IDs because IDs are org-specific. The Apex classes compile successfully in UAT (IDs are just strings), but at runtime, SOQL queries using the hardcoded IDs return zero results. Cases are assigned to null owners. Users are created with no profile. The API endpoint points to the UAT API from the SIT environment — correct by accident. In production, the URL points to the UAT API — incorrect by accident. The defects are discovered only in UAT integration testing, requiring 2 days of developer time to locate and replace all 14 hardcoded values across the codebase.",
    better_path:
      "No org-specific identifier or environment-specific value should ever appear in Apex code, Flow formulas, or metadata files. Use Custom Metadata Types for all configuration that varies by environment. Create a `Configuration__mdt` Custom Metadata Type with fields: `DeveloperName` (Text, ExternalId), `Value__c` (Text), `Environment__c` (Text, optional). Create records for each configuration value, keyed by DeveloperName: `Default_Case_Queue`, `Default_Approver_User`, `ERP_API_Base_URL`. In Apex, retrieve at runtime: `Configuration__mdt config = Configuration__mdt.getInstance('Default_Case_Queue')`. In Flow, use Get Records on the Custom Metadata Type filtered by DeveloperName. Custom Metadata records deploy with the package — they travel with the code and can be configured per environment in the target org. Use Named Credentials for all external endpoint URLs — the URL is stored in the Named Credential, not in code, and can be configured differently in each environment without a code change. Establish a pre-deployment checklist that includes a search for hardcoded 15/18-character Salesforce IDs in all Apex and Flow files.",
    severity: "high",
    components: ["Apex", "Flow", "Configuration", "Deployment"],
    tags: ["si-patterns", "hardcoded-id", "custom-metadata", "configuration", "deployment", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-005",
    title: "No rollback strategy for multi-step cross-object DML — partial commit leaves data in an inconsistent state on any mid-transaction failure",
    scenario:
      "A new customer onboarding process executes a sequence of DML operations across five objects: Account creation, Contact creation, a Contract record initialisation, a Portal_User__c provisioning record, and an Onboarding_Checklist__c record. The entire sequence is implemented in a single Apex service class called from a Screen Flow. The service class executes each DML in sequence without a Savepoint or a UnitOfWork pattern — five separate `insert` statements. In production, the Portal_User__c insert fails because the external portal provisioning validation rule requires a Contract number that has not yet been generated by a trigger on the Contract record (an async operation). The Apex service throws a DmlException on step 4. Because the first three inserts already succeeded (no Savepoint was set), Salesforce does not roll them back. The Account, Contact, and Contract records are committed. The Portal_User__c and Onboarding_Checklist__c records are not. The customer exists in Salesforce but has no portal access and no onboarding checklist. The onboarding coordinator receives no notification of the partial failure. The customer calls support 3 days later and the support team spends 2 hours manually patching the missing records before discovering 11 other customers in the same inconsistent state from the past week.",
    better_path:
      "Multi-step DML operations that must succeed or fail atomically must use either a Salesforce Savepoint / rollback pattern or the fflib UnitOfWork pattern. Savepoint approach: `Savepoint sp = Database.setSavepoint()` before the first DML; in the catch block, `Database.rollback(sp)` to revert all DML in the transaction, then log the error and surface a clean failure message. UnitOfWork approach (preferred for enterprise patterns): use `fflib_ISObjectUnitOfWork.registerNew()` for each record as it is prepared; call `uow.commitWork()` once at the end — a single atomic commit. If the commit fails, no records are inserted. For the portal user case specifically, redesign the sequence to avoid the async dependency: generate the Contract number synchronously before the Portal_User__c insert, or split the process across two async steps with an explicit state machine (Onboarding_Status__c field) so any failure is visible, queryable, and resumable. Document the rollback strategy for every multi-step operation in the SDD before build.",
    severity: "high",
    components: ["Apex", "DML", "Data Integrity", "Architecture"],
    tags: ["si-patterns", "rollback", "savepoint", "DML", "data-integrity", "unit-of-work", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-006",
    title: "No dead-letter queue for failed Platform Event messages — transient subscriber failures cause permanent data loss",
    scenario:
      "A Platform Event-based integration publishes Order_Event__e events from Salesforce to an external order management system. The external subscriber is a MuleSoft flow that receives the event, transforms the payload, and posts to the OMS API. The integration design documents the happy path: event published → subscriber receives → OMS updated. No dead-letter handling is designed. In production, the MuleSoft subscriber experiences a 4-hour outage during a maintenance window. During the outage, 847 Order_Event__e events are published by Salesforce. Platform Events have a 72-hour replay window — after the subscriber restarts, it replays from the last ReplayId checkpoint. The MuleSoft flow restarts but the ReplayId checkpoint was not persisted — it was stored in memory and lost during the restart. The subscriber begins consuming from the current position (no replay), missing all 847 events published during the outage. 847 orders are never transmitted to the OMS. The orders exist in Salesforce as 'Confirmed' but the OMS has no record of them. The discrepancy is discovered 6 days later during a financial close. The manual reconciliation and OMS data repair requires 3 days of effort.",
    better_path:
      "Every event-driven integration must include a dead-letter strategy and a gap-fill mechanism. Dead-letter: any event that the subscriber fails to process after the maximum retry count must be written to a dead-letter channel (a separate Platform Event topic, an SQS dead-letter queue, or a custom Salesforce Dead_Letter__c object). The dead-letter channel triggers an operational alert. Gap-fill: the subscriber must persist its last processed ReplayId to a durable store (database, Salesforce custom object, S3) after every successful event processing — not in memory. On subscriber restart, read the persisted ReplayId and replay from that position. If the subscriber has been offline for more than 2.5 days (approaching the 3-day limit), trigger an immediate gap-fill: a Bulk API query of all Salesforce records in the relevant state since the last processed timestamp, and a reconciliation job that identifies and re-processes any records not reflected in the downstream system. Alert when the subscriber lag exceeds 24 hours — this is a canary for approaching the retention window before events are lost.",
    severity: "high",
    components: ["Platform Events", "Integration", "Error Handling"],
    tags: ["si-patterns", "platform-events", "dead-letter", "replayid", "gap-fill", "idempotency", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-007",
    title: "Agentforce PII exposed in LLM prompt context without Einstein Trust Layer masking — Privacy Act breach in regulated deployment",
    scenario:
      "An Agentforce agent is deployed for a health insurance client's member services team. The agent helps service agents look up member details and policy information. A custom Agent Action is built that calls an Apex InvocableMethod, which queries the Member__c object and returns the member's full name, date of birth, Medicare number, policy number, and address. The action injects the full query result directly into the agent's conversation context as a JSON string: `Here is the member record: { name: 'Jane Smith', dob: '1978-03-15', medicare: '1234-56789-0', ... }`. The developer does not configure Einstein Trust Layer data masking because they assumed the Trust Layer only applied to public-facing agents, not internal-user agents. The Salesforce instance processes the LLM inference via Anthropic's Claude API through the Einstein Trust Layer infrastructure. Without masking configured, the full Medicare number and date of birth are transmitted to the LLM in the prompt payload. The client's Privacy Act obligations require that Medicare numbers are never transmitted outside the client's controlled environment in unmasked form. An internal audit 3 months after go-live identifies the violation. The client must notify the Office of the Australian Information Commissioner, conduct a privacy impact assessment, and redesign the integration — a 6-week effort plus regulatory reporting obligations.",
    better_path:
      "All Agentforce custom actions that retrieve personal, health, financial, or government-identifier data must be configured with Einstein Trust Layer data masking before any data is injected into a prompt context. In the Trust Layer configuration, define masking rules for each PII field type: Medicare numbers, Tax File Numbers, dates of birth, and government identifiers must be masked using static masking (replaced with a placeholder token) before the data reaches the LLM. The agent receives the masked token, not the real value. For actions where the agent needs to confirm a member's identity (the agent needs to know the DOB to confirm, but must not transmit it to the LLM), use a verification action that compares user-provided input against a stored value on the Salesforce side and returns only a boolean `verified: true/false` — the sensitive value never enters the prompt. Apply the Trust Layer audit logging for all agent interactions in regulated deployments — the audit log captures what data was accessed, by which agent, for which user, at what time — providing the evidentiary record required by Privacy Act and GDPR audit obligations.",
    severity: "critical",
    components: ["Agentforce", "Security", "Privacy", "Einstein Trust Layer"],
    tags: ["si-patterns", "agentforce", "PII", "trust-layer", "privacy", "compliance", "sf-patterns"],
    source: "sf-patterns",
  },
  {
    id: "SI-008",
    title: "Data migration without a runbook — no rollback criteria, no cutover window, no reconciliation count — go-live failure with no recovery path",
    scenario:
      "A data migration moves 2.3 million customer records from a legacy CRM into Salesforce as part of a go-live cutover. The migration is executed using Bulk API 2.0 jobs scripted by the ETL developer. No migration runbook is documented. The cutover begins at 11:00 PM on a Friday. At 2:30 AM, the migration has loaded 1.8 million records when a Bulk API job begins failing — approximately 15% of Contacts are being rejected with 'FIELD_INTEGRITY_EXCEPTION: Account ID: id value of incorrect type'. The ETL developer has no documented rollback criteria — there is no pre-agreed threshold at which the migration is aborted. The project manager wakes the architect, who joins at 3:00 AM. There is no rollback plan. The 1.8 million already-loaded records cannot be deleted quickly — a DELETE Bulk API job for 1.8 million records takes approximately 45 minutes. The legacy CRM was taken offline at 11:00 PM as part of the cutover freeze. By 3:30 AM the team decides to continue loading; the 500k failed records are skipped. Salesforce goes live at 6:00 AM with 500k missing customer records. The customer service team opens at 8:00 AM and begins receiving calls from customers who cannot be found in the system. The missing records are not loaded until the following Monday after the root cause (a malformed Account ID prefix in the legacy extract) is identified and the extract is corrected.",
    better_path:
      "Every data migration must be governed by a written runbook produced and reviewed before the cutover window begins. The runbook must include: (1) go / no-go criteria — specific pre-cutover validation queries (record count in source, record count expected in target, duplicate check results) and pass/fail thresholds; (2) rollback criteria — the specific error rate or failure count at which the migration is aborted and the rollback procedure is initiated (e.g. 'abort if more than 1% of records in any job fail with a data integrity error'); (3) rollback procedure — specific commands or scripts to delete all loaded records and restore the legacy system to read-write mode, with estimated execution time; (4) post-load reconciliation — SQL or SOQL queries that count and compare source records to target records per object, per record type, and per key segment; (5) cutover window — start time, hard stop time, decision point at 50% completion, and communications plan if the hard stop is reached. The runbook must be dry-run in the UAT environment at full production data volume at least 2 weeks before the production cutover. Any step that cannot be completed within the dry-run window must be optimised before the production cutover is scheduled.",
    severity: "high",
    components: ["Data Migration", "Architecture", "Governance"],
    tags: ["si-patterns", "data-migration", "runbook", "cutover", "rollback", "reconciliation", "sf-patterns"],
    source: "sf-patterns",
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
    console.error("[seed-si-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-si-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of siFailurePatterns) {
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
  for (const pattern of siFailurePatterns) {
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
          agent_hints: ["sf-patterns"],
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
