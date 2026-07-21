/**
 * Seed APEX-001 to APEX-008 (Apex failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:apex-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const apexFailurePatterns = [
  {
    id: "APEX-001",
    title: "SOQL inside a for loop in Apex trigger — guaranteed 101 governor limit failure on bulk DML",
    scenario:
      "An AccountTrigger fires on before update. The trigger handler iterates Trigger.new with a for loop and executes a SOQL query inside each iteration to retrieve related Contact records for that Account. In the developer sandbox, a single-record update fires one SOQL query and passes all tests. When the sales team runs a Data Loader update on 200 Account records, the trigger fires 200 SOQL queries in a single transaction. The platform throws 'Too many SOQL queries: 101' governor limit exception after the 101st iteration, rolling back the entire DML batch. All 200 Account updates fail with no partial commit. The failure is never seen in unit tests because every test exercises only one record.",
    better_path:
      "Collect all IDs from Trigger.new into a Set<Id> before any loop. Execute a single SOQL query outside the loop to retrieve all related Contact records, and load the results into a Map<Id, List<Contact>> keyed by AccountId. Then iterate Trigger.new inside the loop and look up related records from the map in O(1). The single bulkified SOQL query handles 1 or 200 records identically — the trigger scales to the maximum bulk limit without approaching governor limits. This is the fundamental Apex bulkification pattern: collect all IDs first, query once, then process. Apply the same pattern to any SOQL query that would otherwise fire once per record.",
    severity: "critical",
    components: ["Apex", "Trigger", "Governor Limits"],
    tags: ["apex", "trigger", "SOQL", "governor-limits", "bulkification", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-002",
    title: "Business logic in trigger body instead of handler class — blocks reuse, testing, and consolidation",
    scenario:
      "An OpportunityTrigger contains 300 lines of business logic directly in the trigger body: SOQL queries, DML operations, field calculations, and conditional branching for before-insert, before-update, and after-update contexts. A second requirement arrives to run the same discount calculation logic from a Batch job that repairs historical Opportunities. The developer cannot reuse the trigger logic because it is tightly coupled to Trigger context variables (Trigger.new, Trigger.oldMap) which do not exist outside a trigger context. A second developer creates a separate utility class that duplicates the same calculation. Over 18 months, the same logic exists in three places with subtle divergences. A bug fix in one path does not propagate to the others and the inconsistency causes an audit discrepancy.",
    better_path:
      "Move all business logic into a dedicated handler class (e.g., OpportunityTriggerHandler). The trigger body contains exactly one dispatching call per context: new OpportunityTriggerHandler().onBeforeUpdate(Trigger.new, Trigger.oldMap). The handler methods accept List<SObject> and Map<Id, SObject> parameters — not Trigger context variables — making them independently callable from Batch, Queueable, test classes, and other callers without modification. The trigger body becomes a one-line delegator. When using fflib, reduce the trigger body further to a single line: fflib_SObjectDomain.triggerHandler(Opportunities.class). Business logic defined once, exercised everywhere.",
    severity: "high",
    components: ["Apex", "Trigger", "Architecture"],
    tags: ["apex", "trigger", "handler", "architecture", "reuse", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-003",
    title: "Batch Apex used for small-volume async operation — excess complexity occupies shared flex queue slots",
    scenario:
      "A requirement calls for sending a notification email and updating a Status field on a single Account after a contract is signed. The developer implements this as a Batch Apex class with execute() scope of 200, triggered from a trigger via Database.executeBatch(). In production, the operation always processes exactly one Account record. The Batch framework creates a full job with start/execute/finish phases, logs an AsyncApexJob record, and occupies one of the five concurrent batch flex queue slots — a shared org-level resource. When 20 contracts are signed simultaneously, 20 batch jobs are enqueued. The flex queue fills. Other business-critical nightly batch jobs that process millions of records are delayed past their SLA window. The root cause is using Batch Apex because the developer was familiar with it, not because it was the right tool for the volume.",
    better_path:
      "Queueable Apex is the correct tool for async processing of 1–200 records that does not require cursor-based iteration over a full object table. Implement a class that implements Queueable with an execute(QueueableContext ctx) method accepting the Account IDs as constructor parameters. Call System.enqueueJob(new ContractNotificationJob(accountId)) from the trigger. Queueable jobs are lightweight, do not occupy Batch flex queue slots, support chaining up to 5 levels deep, and allow complex object state to be passed through constructor parameters. Reserve Batch Apex for operations that must iterate over millions of records or that require the Database.Stateful interface to accumulate results across chunk boundaries. Document the selection rationale (Queueable vs Batch vs Future) in the SDD for every async requirement.",
    severity: "high",
    components: ["Apex", "Batch", "Queueable", "Async"],
    tags: ["apex", "batch", "queueable", "async", "governor-limits", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-004",
    title: "Public-facing Apex class without sharing keyword — runs in system context, bypasses record-level security",
    scenario:
      "An Experience Cloud community allows external partners to view and retrieve their own Contract records. A custom Apex REST resource (@RestResource) handles the contract retrieval. The class is declared as 'public class ContractService' with no sharing keyword. In Salesforce, a class with no sharing keyword inherits the sharing context of its caller. For REST callouts from the Experience Cloud guest session or an authenticated community user, the class runs in the System context, returning all Contract records regardless of ownership or sharing rules. An external partner logs in and is able to retrieve contracts belonging to every other partner in the system. The defect is invisible during internal testing because admin users can see all records anyway. It is discovered only in a partner UAT session.",
    better_path:
      "Every Apex class that handles data access for external or community users must declare 'with sharing' unless there is an explicit, documented, and reviewed reason to escalate sharing. Declare 'public with sharing class ContractService'. For internal platform code in the service and domain layers (called from triggers, not directly from user-facing entry points), use 'inherited sharing' to defer to the caller's sharing context without hardcoding an escalation or restriction. Audit every class reachable from a @RestResource, @AuraEnabled method, Visualforce page, or LWC wire adapter for the correct sharing keyword. Run a SOQL query returning all records as a community user in UAT to confirm that row-level security is enforced before go-live.",
    severity: "critical",
    components: ["Apex", "Security", "Experience Cloud"],
    tags: ["apex", "WITH SHARING", "security", "FLS", "experience-cloud", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-005",
    title: "@isTest(SeeAllData=true) in test class — test depends on org data, breaks in scratch orgs and CI",
    scenario:
      "A test class for an Account trigger uses @isTest(SeeAllData=true) because the developer could not figure out how to create the required PricebookEntry test data — accessing the standard pricebook normally requires special handling. The test passes in the developer sandbox where test pricebooks and products were manually created months ago. When the same test runs in a fresh scratch org during a CI pipeline, there is no manually created data and the test fails with a null pointer exception. When the test is run in a new sandbox seeded from a partial production refresh, it passes intermittently depending on which records were included. The test cannot reliably verify any business logic because its outcome depends on data the test class does not control or create.",
    better_path:
      "Every test class must use @isTest(SeeAllData=false), which is the default since API v24 and must never be overridden. For standard pricebook access, use Test.getStandardPricebookId() — this is the official Apex API for retrieving the standard pricebook in a test context and works in any org. For all other required reference data, create it programmatically in a @testSetup method using a dedicated TestDataFactory class. If a record genuinely cannot be created in a test context due to a locked managed package object (a narrow exception), document the specific limitation with a comment, the package version, and a Jira ticket to refactor when the package constraint is resolved. Tests that depend on org data are not tests — they are org health checks.",
    severity: "high",
    components: ["Apex", "Testing"],
    tags: ["apex", "test-class", "SeeAllData", "test-data-factory", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-006",
    title: "Hardcoded Salesforce record IDs in Apex code — org-specific IDs break on deployment to any other org",
    scenario:
      "A service class needs to assign all escalated Cases to a specific Tier 2 Support queue. The developer hardcodes the Queue's record ID directly in the Apex class: ownerId = '00G1n000000abcXXX'. The class passes all tests in the developer sandbox because the Queue exists with that exact ID in that org. When the code is deployed to UAT, the same Tier 2 Support queue exists but was created with a different record ID because Salesforce record IDs are org-specific. The deployment succeeds without error. At runtime, the SOQL query SELECT Id FROM Group WHERE Id = '00G1n000000abcXXX' returns zero results. Every escalated Case is assigned to null Owner. The Queue exists in UAT and the logic is correct — only the ID is wrong. The same failure repeats in production with a third ID.",
    better_path:
      "Never hardcode record IDs in Apex, configuration files, or metadata. Retrieve IDs at runtime using stable, deployment-portable identifiers. Query a Queue by its DeveloperName: SELECT Id FROM Group WHERE DeveloperName = 'Support_Tier_2' AND Type = 'Queue'. DeveloperName is set at creation, does not change, and is deployment-stable across all orgs. For configuration values that need to be different per environment (e.g. a Record Type name, a default user, a queue assignment threshold), use Custom Metadata Types — store the DeveloperName or external key in metadata, query at runtime, then look up the Salesforce ID. Document every runtime ID lookup as a critical deployment dependency in the SDD so it appears on the go-live checklist and is verified before cutover.",
    severity: "critical",
    components: ["Apex", "Configuration"],
    tags: ["apex", "hardcoded-id", "configuration", "deployment", "custom-metadata", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-007",
    title: "DML statement inside a for loop — hits 150 DML limit on any bulk operation",
    scenario:
      "A trigger on the Contact object processes new Contact records and creates a follow-up Task for each Contact. The developer writes a for loop that iterates Trigger.new and calls 'insert new Task(...)' inside the loop body. With a single Contact insert in the developer org, one DML statement fires and all tests pass. A data migration loads 500 Contacts using Data Loader in batches of 200. Within the first batch of 200 Contacts, the loop executes 200 individual DML insert calls. After the 150th iteration, the platform throws 'Too many DML statements: 151'. All 200 Contacts in that batch fail and the partial batch is rolled back. The migration team sees 300 successful Contacts and 500 failed records across batches with no partial success and no useful error message for each failed Contact.",
    better_path:
      "Declare a List<Task> taskList before the loop. Iterate Trigger.new inside the loop, create each Task object, and add it to taskList using taskList.add(t). After the loop completes, execute a single 'insert taskList' statement. One DML statement processes all records regardless of batch size — 1 record or 200 records costs the same one DML statement. This is the core bulkification pattern: accumulate in a collection, act once after the loop. The same pattern applies to update, delete, and upsert. Code review must flag any DML keyword (insert, update, upsert, delete, undelete) that appears inside a loop body. When using fflib, the UnitOfWork pattern enforces this automatically — registerNew/registerDirty inside the loop, commitWork once after.",
    severity: "critical",
    components: ["Apex", "Trigger", "Governor Limits"],
    tags: ["apex", "DML", "governor-limits", "bulkification", "trigger", "sf-apex"],
    source: "sf-apex",
  },
  {
    id: "APEX-008",
    title: "Mixed DML error — setup and non-setup objects inserted in the same Apex transaction",
    scenario:
      "A test class verifies that a community portal sharing rule works correctly. The test method creates a test User record (a setup object) using 'insert testUser' and then immediately creates an Account record (a non-setup object) using 'insert testAccount' in the same execution context. At runtime, Salesforce throws 'System.TypeException: DML operation INSERT not allowed on User in test methods that have SeeAllData turned off, or that insert non-setup objects in the same transaction.' The entire test class fails on every run. This same error pattern occurs in production code: a Queueable job creates a Community User (setup object) and then in the same execute() method inserts a Contact linked to that portal user (non-setup object). The Queueable throws the same TypeException at runtime for every single execution. The error is not catchable with try/catch — it is a platform-enforced transaction boundary violation.",
    better_path:
      "Setup objects (User, Profile, PermissionSet, Group, GroupMember, RoleOrTerritory) and non-setup objects (Account, Contact, custom objects) cannot participate in DML in the same Apex transaction. In test classes, wrap all setup-object DML inside System.runAs(adminUser) { insert testUser; } — this executes the setup DML in a separate transaction context, after which the test method can freely DML non-setup objects. In production code, split the operations across two separate async contexts: the first Queueable creates the User and then enqueues a second Queueable that creates the linked Contact once the User ID is available. Document any requirement that pairs User creation with related-object creation as a two-step async flow in the SDD. Mixed DML errors cannot be caught and recovered at runtime — they must be prevented by design at the architecture stage.",
    severity: "high",
    components: ["Apex", "Mixed DML", "Testing"],
    tags: ["apex", "mixed-DML", "setup-objects", "test-class", "queueable", "sf-apex"],
    source: "sf-apex",
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
    console.error("[seed-apex-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-apex-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of apexFailurePatterns) {
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
  for (const pattern of apexFailurePatterns) {
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
          agent_hints: ["sf-apex"],
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
