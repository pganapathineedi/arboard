/**
 * Seed FLOW-001 to FLOW-008 (Flow failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:flow-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const flowFailurePatterns = [
  {
    id: "FLOW-001",
    title: "Get Records inside a loop iteration in a record-triggered flow — guaranteed SOQL governor limit failure on bulk DML",
    scenario:
      "A record-triggered Flow fires After Save on the Case object. The Flow uses a Loop element to iterate over a collection of related Entitlement records retrieved in a prior Get Records step. Inside the Loop, another Get Records element queries SLA__c records to find the active SLA for each Entitlement. In the developer sandbox, a single Case update triggers the loop once, executes one Get Records inside the loop, and the Flow passes testing. When the support operations team runs a Data Loader update on 150 Cases to bulk-close a backlog, the Flow fires for each Case. Inside each interview the loop iterates 3 Entitlements, executing 3 Get Records queries per interview. At 150 Cases × 3 queries = 450 SOQL queries accumulated across the transaction batching. Salesforce batches record-triggered flows in groups of up to 200 records per transaction; within that batch of 150 Cases × 3 queries = 450 SOQL queries, the platform throws 'Too many SOQL queries: 101' after the 34th Case interview's third query. The entire batch of 150 Case updates rolls back. No Cases are closed. The support operations team receives a generic error with no guidance. The defect is never caught in testing because no test exercised more than one record at a time.",
    better_path:
      "Move the Get Records element outside the loop. Before the Loop element, execute a single Get Records that retrieves ALL SLA__c records for ALL Entitlements in the collection at once, using a filter like `EntitlementId IN {!EntitlementIdCollection}`. Store the results in a collection variable. Inside the Loop, use a Filter Collection or a Decision element to find the relevant SLA record from the already-fetched collection — this is a pure in-memory operation with no additional SOQL cost. The single Get Records outside the loop handles 1 Entitlement or 1000 identically, consuming exactly one SOQL query regardless of collection size. This is the Flow bulkification pattern: fetch all data before the loop, process data inside the loop from memory, execute all DML after the loop. Apply the same approach to every Get Records element — if it appears inside a Loop, it must be moved outside.",
    severity: "critical",
    components: ["Flow", "Governor Limits", "Bulkification"],
    tags: ["flow", "get-records", "loop", "governor-limits", "SOQL", "bulkification", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-002",
    title: "Missing fault connector on Update Records element — silent partial failure leaves records in inconsistent state",
    scenario:
      "A record-triggered After Save Flow fires on the Contract object when a Contract is set to 'Active'. The Flow retrieves related Order records and updates their Status to 'Confirmed'. The Update Records element has no fault connector — the developer assumed that if the DML succeeded for the triggering record, it would always succeed for the related records. In production, a subset of Orders have a validation rule requiring an Approval_Date__c field to be populated before Status can be set to 'Confirmed'. When a Contract is activated and its related Orders lack the approval date, the Update Records element throws a DML exception on the failing Orders. Because there is no fault connector, Salesforce does not roll back the entire flow interview — it propagates the unhandled exception up the call stack and rolls back the entire transaction including the Contract's Activated status. The Contract remains in a pre-activation state with no error message shown to the user — the page refreshes and the status appears unchanged. The user tries again, same result, and files a support ticket. The support team has no error log, no fault path output, and no way to determine which Orders caused the failure without examining debug logs. Separately, a data load of 200 Contracts fires the same flow; the 12 Contracts with Orders missing approval dates fail silently, and 12 contracts remain unactivated with no notification to the business.",
    better_path:
      "Add a fault connector on the Update Records element and wire it to an error handling path. The error path should: (1) create an Error_Log__c record capturing the flow name, the triggering record ID, and the `{!$Flow.FaultMessage}` variable so the error is durable and queryable; (2) if this is a user-facing context (Screen Flow), display a human-readable error message explaining the failure and offering a support contact path; (3) publish a Platform Event to an operational alerting channel for bulk-load scenarios where no user is watching. Design the flow to allow partial Order updates using an Apex InvocableMethod with `Database.update(orders, false)` (allOrNone=false) — this permits successful Orders to commit while failed Orders are logged individually with their specific error reason, rather than failing the entire batch. Treat fault connectors as mandatory on every interaction element — their absence is an architectural gap, not an edge case.",
    severity: "critical",
    components: ["Flow", "Error Handling", "Fault Connector"],
    tags: ["flow", "fault-connector", "error-handling", "DML", "silent-failure", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-003",
    title: "Flow and Apex trigger both performing DML on the same field in the same transaction — last-writer-wins produces unpredictable field values",
    scenario:
      "An Apex after-update trigger on the Opportunity object calculates and sets the Discount_Category__c field based on the opportunity amount and account tier, writing the result back via a DML update. A record-triggered After Save Flow on the same object also updates Discount_Category__c based on a different set of conditions — the close date proximity and the current quarter. Both run in the same Salesforce order of execution: the Apex trigger fires first (step 4), then the After Save Flow fires (step 6). In a single-record scenario, the Flow's value always overwrites the Apex trigger's value — the Discount_Category__c field consistently reflects the Flow's calculation, and during testing this appears correct because the Flow's logic was the most recently implemented. Six months later, the Apex trigger is updated to include a new condition. The developer tests the Apex class in isolation and confirms the new logic is correct. In production, the Flow still overwrites the Apex result in every transaction — the Apex change has no observable effect. The business notices that discounting behaviour has not changed despite the deployed code change. A separate bug is filed. It takes a senior developer 3 hours to discover the dual-ownership conflict by reading the order of execution documentation and tracing both automations.",
    better_path:
      "Every field update, record creation, and related-record operation must have a single documented automation owner — either Flow or Apex, never both. Before deploying any automation that touches an existing field, query all active automations on the same object (Triggers, Flows, Process Builder, Workflow Rules) and confirm no other automation writes to the same field. Document the ownership in an Automation Registry: a simple spreadsheet or Confluence page listing each object, each field that automation writes to, and the single owning automation. When an existing automation already owns a field and a new requirement extends the logic, the new logic must be added to the existing automation — not deployed as a parallel automation. If both Apex and Flow are legitimately needed for separate fields, document the order of execution boundary explicitly and confirm through a bulk test (200-record load) that the fields do not interact unexpectedly.",
    severity: "high",
    components: ["Flow", "Apex", "Order of Execution"],
    tags: ["flow", "apex", "order-of-execution", "dual-automation", "field-conflict", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-004",
    title: "Get Records result not null-checked before reference — NullPointerException on any record with no matching children",
    scenario:
      "A record-triggered After Save Flow fires on the Account object whenever an Account is marked as 'Premium'. The Flow uses Get Records to retrieve the most recent Contract record for the Account: filter `AccountId = {!$Record.Id}` AND `Status = 'Active'`, sort by CreatedDate descending, limit 1. The Flow then uses an Assignment element to copy the Contract's End_Date__c field to the Account's Contract_Expiry__c field. During development and testing, every test Account has at least one active Contract — the Get Records always returns a record. In production, a batch of 340 Accounts is marked as Premium through a data migration. 47 of those Accounts have no active Contracts — they are newly created accounts without any contract history. For those 47 Accounts, the Get Records element returns null (no records found). The Get Records element does NOT fault on zero results — it returns null. The subsequent Assignment element tries to reference `{!ContractRecord.End_Date__c}` where `{!ContractRecord}` is null. The Flow throws a NullPointerException with the message 'Error element Get_Active_Contract (FlowRecordLookup). The flow tried to access a value that is null.' All 47 Accounts fail. Because there is no fault connector on the Get Records element (null is not a fault), the error propagates as an unhandled exception. The 340-Account batch includes these 47 in the same DML batch; the entire batch rolls back. 340 Accounts remain un-upgraded.",
    better_path:
      "After every Get Records element, add a Decision element that checks whether the result variable is null: condition `{!ContractRecord} IS NULL` routes to the null/zero-results path; `{!ContractRecord} IS NOT NULL` (or `does not equal null`) routes to the main processing path. On the null path, choose an action appropriate to the business requirement: (1) do nothing and exit the flow gracefully — the Account has no Contract and no expiry date should be set; (2) set the target field to a default value or blank; (3) create a Task for the account owner to follow up. Never reference a Get Records result variable without first confirming it is not null in a Decision element. Apply this pattern universally — treat null results as a first-class business case that the flow must handle, not an edge case that will never happen in production.",
    severity: "high",
    components: ["Flow", "Get Records", "Null Handling"],
    tags: ["flow", "get-records", "null-check", "NullPointerException", "error-handling", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-005",
    title: "Scheduled Flow with no end condition — infinite runaway schedule consuming Apex CPU and Batch flex queue slots",
    scenario:
      "A Scheduled Flow is designed to send a reminder email to Account owners for any Account that has had no Activity in the past 30 days. The Flow is scheduled to run daily at 8:00 AM. The entry criteria filter is: `Last_Activity_Date__c < {!$Flow.CurrentDate} - 30`. The flow has no end condition or record-scope limit beyond the date filter. In the first month after go-live, the org has 12,000 Accounts. The scheduled flow processes all 12,000 on each run. After 18 months, the Account object has grown to 85,000 records. The scheduled flow now processes 85,000 records daily. Each flow interview consumes CPU time; the aggregate CPU consumption across 85,000 interviews approaches the org's daily Apex CPU budget. The scheduled flow runs for 4.5 hours each morning, occupying one of the org's 5 concurrent Batch Apex flex queue slots for that entire period. Critical nightly batch jobs — account scoring, revenue forecasting, overnight sync — queue behind the scheduled flow and run past their SLA windows. The infrastructure team cannot identify the root cause because the scheduled flow does not appear in Apex Jobs — it appears in Scheduled Flows, a separate UI section that the monitoring team does not routinely check.",
    better_path:
      "Design scheduled flows with a defined scope and a clear exit strategy. For the reminder email use case: add a custom field `Reminder_Sent_Date__c` on Account; the scheduled flow entry criteria filters for Accounts where `Last_Activity_Date__c < Today - 30` AND `Reminder_Sent_Date__c IS NULL OR Reminder_Sent_Date__c < Today - 30`; after sending the email, the flow updates `Reminder_Sent_Date__c = Today`. This creates a natural scope reduction: Accounts that have been emailed recently are excluded until the next 30-day window. For scheduled flows that process a finite task (e.g. closing all expired trials), set a deactivation date in the schedule definition and document it in the deployment notes. For recurring business processes, cap the record scope with a LIMIT on the Get Records element (e.g. process no more than 1000 records per run) and run more frequently if needed. Monitor scheduled flow execution time in the Scheduled Flows UI and alert when runtime exceeds 60 minutes.",
    severity: "high",
    components: ["Flow", "Scheduled Flow", "Performance"],
    tags: ["flow", "scheduled-flow", "governor-limits", "performance", "runaway", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-006",
    title: "Screen Flow executes DML before final confirmation step — mid-wizard Back navigation leaves records in inconsistent partial state",
    scenario:
      "A Screen Flow guides an insurance agent through a policy amendment process: Screen 1 captures policy holder details, Screen 2 captures coverage changes, Screen 3 captures payment details, and Screen 4 is a confirmation summary. The developer places a Create Records element after Screen 2 to create an Amendment__c record immediately when coverage changes are captured, before the agent reaches the confirmation step. The developer's rationale is to save progress mid-form. Screen 4 has a Submit button that triggers a second Update Records to finalise the Amendment status. In the first week of use, an agent fills out Screen 2 and then presses the Back button (re-enabled in the Flow settings) to correct a coverage date on Screen 1. The Back navigation re-executes the flow from Screen 1, but the Amendment__c record created after Screen 2 already exists in the database and is not rolled back — Screen Flows do not roll back prior DML when the user navigates backward. When the agent completes the wizard a second time, a second Amendment__c record is created. The policy now has two Amendment records in 'Draft' status. The batch job that processes amendments picks up both, creates two policy change transactions in the core insurance system, and both fail as duplicates. The defect is reproduced by every agent who presses Back during the process.",
    better_path:
      "Defer all DML to the final confirmation step of a Screen Flow. Accumulate data from each screen into Flow variables (not records) as the user navigates forward. On the final confirmation screen, present a summary of all data the user has entered. Only after the user confirms on the final screen should Create Records and Update Records elements execute. This ensures the complete, validated data set is committed in a single atomic operation — if the user navigates back at any point before confirmation, no database records exist to be inconsistent. If progress-saving is a genuine requirement (the wizard takes more than 30 minutes to complete), implement it as an explicit 'Save Draft' action on the confirmation screen that creates a Draft record, and route the agent back to the wizard pre-populated from the draft on re-entry. Never use mid-wizard DML as an implicit save mechanism.",
    severity: "high",
    components: ["Flow", "Screen Flow", "DML", "Data Integrity"],
    tags: ["flow", "screen-flow", "DML", "rollback", "data-integrity", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-007",
    title: "Subflow invoked without a fault connector on the parent — unhandled exception from subflow terminates the entire parent transaction",
    scenario:
      "A master onboarding Flow orchestrates a new customer setup process by calling three subflows in sequence: a subflow to create Account and Contact records, a subflow to provision a portal user, and a subflow to send a welcome email via an Apex action. The parent flow has no fault connectors on any of the three subflow invocations. The portal user provisioning subflow calls an Apex InvocableMethod that creates a Community User. In production, the org's community user licence limit is reached — the Apex method throws a `LimitException`. The portal user subflow has an internal fault path that catches the error, but the fault connector on the subflow element inside the parent flow is not present. The LimitException propagates up to the parent flow without the subflow's internal fault path being invoked — subflow-internal fault handling and parent-level subflow fault connectors are independent. The parent flow terminates with an unhandled exception. The Account and Contact created by the first subflow — already committed to the database in a prior DML operation — remain in the system. The welcome email was never sent. The customer exists in Salesforce but cannot log into the portal. The onboarding team has no notification. The customer calls support 2 days later.",
    better_path:
      "Place a fault connector on every subflow invocation element in the parent flow, regardless of whether the subflow has its own internal fault handling. The parent's fault connector handles the case where the subflow raises an unhandled exception that escapes the subflow's internal paths — these two layers of fault handling are independent and both are required. The parent fault path should: (1) log the specific subflow step that failed and the fault message to an error log object; (2) send an operational alert (Platform Event, email, or Slack via an Apex action); (3) if prior subflow steps have already committed records (as in the portal example), create a compensation record flagging that the onboarding is in a partial state, so an operations team member can investigate and complete the setup manually. Design multi-subflow orchestration flows with the understanding that any subflow can fail independently — each failure mode needs a documented recovery path.",
    severity: "high",
    components: ["Flow", "Subflow", "Error Handling", "Fault Connector"],
    tags: ["flow", "subflow", "fault-connector", "error-handling", "orchestration", "sf-flow"],
    source: "sf-flow",
  },
  {
    id: "FLOW-008",
    title: "Multiple stale active flow versions not cleaned up — metadata bloat and admin confusion during production incident response",
    scenario:
      "A high-priority bug fix is required on a record-triggered Flow. The admin navigates to the Flow list in Setup and sees 7 versions of the same flow: versions 1 through 4 are deactivated, version 5 is labelled 'UAT Fix', version 6 is labelled 'Production', and version 7 was just saved as a draft. The admin is uncertain which version is currently active in production — both version 5 and version 6 have the word 'Active' in different column states due to a UI rendering quirk. While the admin investigates, the incident is ongoing. The admin activates version 7 to deploy the fix, but version 7 was saved before the fix was applied — it is actually the pre-fix draft. In a second scenario, the deployment team runs a metadata comparison between the production org and the deployment package. The package contains only the latest version of the flow, but the production org has 7 versions as metadata records. The comparison tool flags differences on all 7 versions, requiring the deployer to manually determine which differences are legitimate and which are stale version noise. The deployment takes 40 minutes longer than planned because of the version cleanup required during the release window.",
    better_path:
      "Maintain exactly one active version and at most one draft version per flow at any time. After every successful UAT sign-off on a new version, immediately deactivate all prior versions and delete them — do not archive them in the org; the deployment history and version control repository are the authoritative record of prior versions. Establish a flow naming convention for in-flight work: append `_draft` to the in-progress version during development and rename it to the canonical name on activation. For teams using source-control-driven deployments (SFDX), the flow metadata in the repository represents the only version — deploying from source ensures the org always reflects the repository state without version accumulation. Include a 'Flow Hygiene' checklist item in every sprint definition of done: for every flow modified this sprint, confirm all prior versions are deactivated and deleted in all environments (dev, UAT, production).",
    severity: "medium",
    components: ["Flow", "Metadata Hygiene", "Versioning"],
    tags: ["flow", "versioning", "metadata-hygiene", "deactivation", "admin", "sf-flow"],
    source: "sf-flow",
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
    console.error("[seed-flow-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-flow-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of flowFailurePatterns) {
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
  for (const pattern of flowFailurePatterns) {
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
          agent_hints: ["sf-flow"],
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
