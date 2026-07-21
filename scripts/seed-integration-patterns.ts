/**
 * Seed INT-001 to INT-008 (Integration failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:integration-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const integrationFailurePatterns = [
  {
    id: "INT-001",
    title: "Named Credential bypass — hardcoded credentials in Apex",
    scenario:
      "Integration callouts are implemented with hardcoded endpoint URLs, usernames, passwords, or access tokens directly in Apex classes or Custom Metadata. Credentials are committed to version control and visible to all developers. A Named Credential exists for the target system but is not used because 'it was faster to hardcode during development'. Credential rotation requires a code deployment.",
    better_path:
      "All external callouts must use Named Credentials exclusively. Store endpoint, authentication type, and OAuth configuration in the Named Credential record. Apex calls the named credential via the callout path (e.g. `callout:My_NC/api/endpoint`). Rotation is then a configuration change with no deployment. Use a dedicated integration user and a scoped connected app per integration — never share credentials across integrations.",
    severity: "critical",
    components: ["NamedCredentials", "Integration", "Apex"],
    tags: ["named-credential", "credentials", "security", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-002",
    title: "Missing callout timeout — unlimited blocking on external latency",
    scenario:
      "HTTP callouts from Apex are made without calling `HttpRequest.setTimeout()`. The default timeout is unlimited. When the external system is degraded or unreachable, the Apex transaction blocks until the platform's hard 120-second transaction limit is reached. In a Batch or Trigger context, a single slow callout stalls the entire job or DML operation. The design has no timeout, no retry, and no dead-letter queue.",
    better_path:
      "Set an explicit timeout on every `HttpRequest` via `setTimeout(milliseconds)` — recommended 10 000–30 000 ms depending on SLA. After timeout, catch `System.CalloutException` and route to a retry mechanism: a Queueable job with exponential backoff for transient failures, or a Platform Event to a dead-letter channel for persistent failures. Document the full error path: timeout → retry (n times) → dead-letter → alert → manual resolution.",
    severity: "high",
    components: ["Integration", "Apex", "Queueable"],
    tags: ["callout", "timeout", "retry", "governor-limits", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-003",
    title: "Platform Event ordering assumption — state corruption on redelivery",
    scenario:
      "The integration design assumes Platform Events are delivered in the order they were published. An event consumer updates downstream state using sequential deltas (e.g. 'set balance to X', 'apply discount Y') expecting events to arrive in publish order. Salesforce Platform Events guarantee at-least-once delivery but do not guarantee ordering. Under load spikes, events for the same record arrive out of order. The downstream system ends up in an inconsistent state with no detection mechanism.",
    better_path:
      "Design Platform Event consumers assuming unordered, at-least-once delivery. Use absolute state payloads instead of deltas — carry the full current state in the event so any order of processing produces the same result. Include a sequence number or timestamp in the payload; consumers reconcile against their current sequence and discard stale events. Add an idempotency key (record ID + event type + version) to the payload so duplicate redelivery is a no-op.",
    severity: "high",
    components: ["PlatformEvents", "Integration"],
    tags: ["platform-events", "ordering", "idempotency", "at-least-once", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-004",
    title: "CDC gap-fill missing — silent data divergence after outage",
    scenario:
      "A Change Data Capture subscription feeds a downstream system. CDC events are retained for 3 days. The integration design has no gap-fill mechanism — if the consumer is offline for more than 3 days (planned maintenance, infrastructure failure, deployment freeze), events are permanently lost. The downstream system diverges from Salesforce with no alert and no reconciliation process. The SDD documents CDC as the integration pattern but says nothing about the 3-day retention boundary.",
    better_path:
      "Every CDC integration must include a documented gap-fill strategy. At minimum: a checkpoint mechanism (last processed ReplayId stored durably), an alert if the consumer lag approaches 2 days (giving a recovery window before the 3-day boundary), and a full-object reconciliation job (Bulk API export → diff → re-sync) that can be triggered manually or automatically when a gap is detected. Document the recovery SLA: how long after a gap is the downstream system expected to be consistent?",
    severity: "high",
    components: ["CDC", "Integration"],
    tags: ["CDC", "change-data-capture", "gap-fill", "retention", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-005",
    title: "OAuth token refresh not handled — silent callout failure on expiry",
    scenario:
      "A connected app uses short-lived OAuth access tokens (typical default: 2 hours). The Apex integration code caches the token in Custom Settings after initial authorisation. No refresh logic is implemented. When the token expires, all callouts return 401 Unauthorized. The error is caught and logged, but there is no re-authorisation path — the integration silently stops processing. Business users see no error; records simply stop syncing. The issue is discovered hours or days later.",
    better_path:
      "Implement automatic token refresh using the OAuth refresh token flow. On receiving a 401 from a callout, invoke the token refresh endpoint using the stored refresh token, update the cached access token, and retry the original callout once. If the refresh itself returns `invalid_grant` (refresh token expired or revoked), raise an alert immediately and do not retry silently — the integration requires human re-authorisation. Use JWT Bearer Flow for server-to-server integrations to eliminate the refresh cycle entirely.",
    severity: "high",
    components: ["OAuth", "Integration", "Apex", "NamedCredentials"],
    tags: ["oauth", "token-refresh", "authentication", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-006",
    title: "External Service not version-pinned — silent breakage on upstream schema change",
    scenario:
      "An External Service is registered in Salesforce from a live API endpoint rather than a versioned OpenAPI specification. The upstream provider updates their API — adds a required request field, renames a response field, or removes an endpoint — without coordinating with the Salesforce team. The External Service-generated Apex classes are not regenerated. Callouts begin failing at runtime with no compile-time warning. Alternatively, the External Service is regenerated from the new spec, breaking all Flows and Apex that referenced the old generated classes.",
    better_path:
      "Register External Services from a versioned, immutable OpenAPI 3.0 specification stored in the repository. Pin the version in the External Service metadata. Establish a schema change notification process with the upstream API owner — any breaking change requires a coordination window and a dual-version migration period. Before regenerating an External Service, run a project-wide search for all Flows and Apex classes referencing the old generated types and update them as a single coordinated change.",
    severity: "high",
    components: ["ExternalServices", "Integration", "Flow"],
    tags: ["external-services", "versioning", "schema-drift", "openapi", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-007",
    title: "Non-idempotent outbound callout — duplicate records on retry",
    scenario:
      "Outbound POST callouts create records in an external system (orders, cases, payments, provisioning requests). The callout has a timeout and a retry mechanism. When the external system receives the request but the response is lost in transit, Salesforce retries the same POST. The external system creates a second record because the POST has no idempotency key. The result is duplicate orders, payments, or provisioning records. The duplicate is discovered when the external system's reconciliation report flags it — sometimes days later.",
    better_path:
      "Every outbound write callout (POST, PUT, PATCH) must include an idempotency key in the request header or body — typically a UUID generated from the Salesforce record ID and operation type (e.g. `Idempotency-Key: {recordId}-{operationType}-{date}`). The external system uses the key to deduplicate: a second request with the same key returns the original response without creating a duplicate. Confirm idempotency key support with the target API during design — if the API does not support it, implement a pre-flight existence check before every POST.",
    severity: "high",
    components: ["Integration", "Apex"],
    tags: ["idempotency", "callout", "retry", "duplicates", "sf-integration"],
    source: "sf-integration",
  },
  {
    id: "INT-008",
    title: "Bulk data load via REST API — rate limit exhaustion and transaction timeout",
    scenario:
      "A data migration or nightly sync pushes 50 000–500 000 records to Salesforce using the standard REST API with single-record or small-batch requests. The integration hits API rate limits (daily API call limit, concurrent limit), causes `TooManyRequests` errors, and the nightly job runs past its maintenance window. Apex trigger logic fires on every REST record individually, consuming governor limits per record. The SDD specifies 'REST API integration' without acknowledging the volume.",
    better_path:
      "Use Bulk API 2.0 for any data load exceeding 10 000 records. Bulk API 2.0 processes records asynchronously in batches of up to 10 000, does not consume the daily API call limit at the same rate, and bypasses most synchronous governor limits on the processing side. Design the nightly sync as a Bulk API job with a status polling loop. For ongoing real-time integration at lower volume (<200 records/transaction), REST API is appropriate — document the volume threshold and confirm it will not be exceeded.",
    severity: "high",
    components: ["BulkAPI", "Integration"],
    tags: ["bulk-api", "data-load", "rate-limits", "governor-limits", "sf-integration"],
    source: "sf-integration",
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
    console.error("[seed-integration-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-integration-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of integrationFailurePatterns) {
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
  for (const pattern of integrationFailurePatterns) {
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
          agent_hints: ["sf-integration"],
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
