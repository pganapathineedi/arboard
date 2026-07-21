/**
 * Seed DATA-001 to DATA-008 (Data Architecture failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:data-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const dataFailurePatterns = [
  {
    id: "DATA-001",
    title: "Non-selective SOQL on LDV object — full table scan under load",
    scenario:
      "A SOQL query filters on a non-indexed field (e.g. a custom picklist, a formula field, or a standard text field without a custom index) on an object holding 2 million+ records. The query is selective in the developer org with 10 000 records but times out in production. The SDD specifies the query pattern but does not confirm selectivity or identify a custom index request. A leading wildcard LIKE filter (`LIKE '%value%'`) is used for search — never selective regardless of object size.",
    better_path:
      "For every SOQL query on an object projected to exceed 100 000 records, confirm selectivity at design time using the Query Plan tool in Developer Console. A selective query must return <10% of total records or <333 000 records. If the required filter field is not auto-indexed (ID, External ID, CreatedDate, Owner, RecordType), request a custom index from Salesforce Support during the design phase — not after go-live. Avoid leading wildcards; use SOSL for full-text search scenarios.",
    severity: "high",
    components: ["SOQL", "LDV", "Performance"],
    tags: ["SOQL", "selectivity", "indexing", "LDV", "query-performance", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-002",
    title: "Ownership skew — millions of records owned by a single user or queue",
    scenario:
      "A queue or integration user is set as the Owner on all records of a high-volume object — for example, an automated process assigns all inbound cases to a 'Triage Queue' until they are claimed. The object has a Private OWD. The role hierarchy query for sharing evaluation must traverse ownership from that single owner node, causing lock contention and SOQL timeout under concurrent access. The design notes 'records owned by the triage queue' but does not identify this as an LDV ownership skew risk.",
    better_path:
      "Limit ownership concentration on LDV objects to a maximum of ~10 000 records per user or queue. If the business process requires a central staging owner, design a rapid reassignment flow that moves records to their final owner within minutes of creation — never let records accumulate indefinitely under one owner. For truly ownerless records (system-generated logs, event records), consider setting OWD to Public Read/Write to eliminate the ownership sharing evaluation overhead, or use a Big Object pattern for append-only data.",
    severity: "high",
    components: ["SharingModel", "LDV", "Performance"],
    tags: ["ownership-skew", "LDV", "sharing", "queue", "performance", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-003",
    title: "Lookup skew — hot parent record with millions of child records",
    scenario:
      "A Lookup or Master-Detail relationship creates a hot parent scenario: a single parent record (e.g. a global account, a master product, a system configuration record) is the parent of millions of child records. Any DML operation on a child record acquires a lock on the parent to update rollup summaries or cascade sharing. Under concurrent load, multiple transactions attempt to lock the same parent simultaneously, producing `UNABLE_TO_LOCK_ROW` errors and failed saves. The data model shows the relationship but volume is not analysed.",
    better_path:
      "Identify hot parent candidates at design time: any parent record expected to have more than 10 000 child records is a lookup skew risk. Mitigations: remove rollup summary fields from the hot parent (convert to async calculation via Apex); replace the direct parent relationship with an intermediate grouping object that distributes children across multiple parents; set the relationship to a Lookup (not Master-Detail) so rollup summaries are not available to tempt future use. Document the peak concurrent DML rate on the hot parent object in the SDD.",
    severity: "high",
    components: ["DataModel", "SharingModel", "Performance"],
    tags: ["lookup-skew", "hot-parent", "lock-contention", "LDV", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-004",
    title: "Missing External ID on integration objects — upsert unreliable at scale",
    scenario:
      "Objects that receive data from external systems have no External ID field. Integration loads use record Name or a composite filter to identify existing records before deciding insert or update. At scale, Name is not guaranteed unique, composite queries are non-selective on LDV objects, and the upsert logic produces duplicate records or updates the wrong record. After 18 months, the object has 300 000 records with significant duplication. A re-keying project is required.",
    better_path:
      "Every object that participates in an integration as a data target must have an External ID field created at the start of the project — before any data is loaded. The External ID field type should be Text or Number, marked as Unique and External ID. Name the field after the source system identifier (e.g. `SAP_Customer_Id__c`). Use this field as the upsert key in all integration loads. External ID fields are automatically indexed, enabling fast, selective upsert operations regardless of object size.",
    severity: "high",
    components: ["DataModel", "Integration", "ExternalID"],
    tags: ["external-id", "upsert", "integration", "deduplication", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-005",
    title: "Skinny table not considered for high-frequency critical query path",
    scenario:
      "A core operational query runs against a 5 million-record object hundreds of times per minute — for example, a case assignment query that selects AccountId, OwnerId, Status, and Priority from a Case object. The query is selective (filtered on indexed Status + RecordType), but response time is still measured in seconds because Salesforce must traverse the full object storage table to retrieve the four needed fields. Performance testing in the full-load performance environment confirms the issue, but there is no design-time plan to address it.",
    better_path:
      "For LDV objects (>1 million records) where a small, fixed set of fields is queried at high frequency and response time is critical, request a Skinny Table from Salesforce Support. A Skinny Table is a custom read-only narrow table maintained by the platform containing only the queried fields — reads are dramatically faster because the table is smaller and fully fits in cache. Identify skinny table candidates at design time: list the top 3–5 most frequent SOQL patterns on each LDV object and confirm the field set. Skinny tables are a Support engagement — they must be planned months before go-live, not retrofitted.",
    severity: "medium",
    components: ["LDV", "SOQL", "Performance"],
    tags: ["skinny-table", "LDV", "query-performance", "support-engagement", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-006",
    title: "Standard REST API used for bulk data load — rate limit exhaustion",
    scenario:
      "A nightly sync or data migration loads 200 000 records into Salesforce using the standard REST API with single-record inserts or small-batch requests (200 records per call). The process consumes the org's daily API limit within hours, blocks other integrations for the rest of the day, and runs past its maintenance window because the throughput ceiling is too low. Each REST call fires triggers, workflow rules, and validation rules synchronously, adding per-record processing overhead at scale. The SDD specifies 'REST API integration' without assessing volume.",
    better_path:
      "Use Bulk API 2.0 for any data load or sync exceeding 10 000 records per run. Bulk API 2.0 processes records in batches of up to 10 000 asynchronously, consumes API quota at a far lower rate than REST, and handles trigger execution differently (bulkified trigger context). Design the nightly sync as a Bulk API 2.0 job: create job → upload CSV batches → close job → poll for completion → retrieve results. Standard REST API is appropriate for real-time, low-volume operations (<200 records per transaction). Document the volume threshold in the SDD and confirm it will not be exceeded in year-three growth projections.",
    severity: "high",
    components: ["BulkAPI", "Integration", "DataModel"],
    tags: ["bulk-api", "data-load", "api-limits", "rate-limits", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-007",
    title: "Private OWD on LDV object with complex sharing rules — sharing evaluation timeout",
    scenario:
      "A high-volume object (10 million records) has a Private OWD with 15 criteria-based sharing rules covering different combinations of RecordType, Region, and Account. Every record query must evaluate these sharing rules to determine visibility. The sharing rule evaluation is non-selective — it cannot use standard indexes in the same way as user-initiated queries. Under concurrent load, sharing calculation times out, users see 'Unable to retrieve records', and bulk operations on records owned by sharing-rule beneficiaries fail intermittently. The sharing model was designed for a 100 000-record data set and never re-evaluated as volume grew.",
    better_path:
      "For objects projected to exceed 1 million records, evaluate the sharing model before finalising OWD. Private OWD with many criteria-based sharing rules creates sharing evaluation overhead that scales poorly with record volume. Mitigations: reduce sharing rules to the minimum necessary (fewer, broader rules perform better); use role hierarchy instead of criteria-based rules where the org structure maps to the data access pattern; for objects where all users should see all records, use Public Read/Write to eliminate sharing evaluation entirely. Document the sharing evaluation design for every LDV object in the SDD.",
    severity: "high",
    components: ["SharingModel", "LDV", "Performance"],
    tags: ["sharing-model", "OWD", "sharing-rules", "LDV", "performance", "sf-data"],
    source: "sf-data",
  },
  {
    id: "DATA-008",
    title: "Big Object not considered for append-only audit or log pattern",
    scenario:
      "A custom object is used to store audit events, integration logs, activity history, or compliance records. The object is insert-only with no deletes — records accumulate indefinitely. After two years, the object holds 50 million records, consuming storage budget, degrading report performance, and causing SOQL timeouts on audit queries. No archival strategy was designed. The SDD described the pattern as 'a custom log object' with no volume projection or lifecycle strategy.",
    better_path:
      "Append-only, high-volume data patterns — audit logs, integration event records, activity history — are the primary use case for Salesforce Big Objects. Big Objects support 1 billion+ records, have no storage cost impact on standard org limits, and use a custom index structure optimised for time-series queries. Design decisions: Big Objects have no triggers, no workflow, no reports — query via SOQL with the Big Object index fields only. If the use case requires Salesforce Reports or declarative automation, consider a short-retention standard object plus Big Object archival after 90 days.",
    severity: "medium",
    components: ["BigObject", "DataModel", "LDV"],
    tags: ["big-object", "archival", "audit-log", "append-only", "LDV", "sf-data"],
    source: "sf-data",
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
    console.error("[seed-data-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-data-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of dataFailurePatterns) {
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
  for (const pattern of dataFailurePatterns) {
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
          agent_hints: ["sf-data"],
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
