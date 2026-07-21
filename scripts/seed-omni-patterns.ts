/**
 * Seed OMNI-001 to OMNI-008 (OmniStudio failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:omni-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const omniFailurePatterns = [
  {
    id: "OMNI-001",
    title: "DataRaptor used for HTTP callouts — wrong tool for external integration",
    scenario:
      "An Integration Procedure step needs to call an external REST API. The developer uses a DataRaptor Remote action instead of an Integration Procedure HTTP Action because it was quicker to configure. DataRaptor Remote is designed for SOQL queries and DML operations against Salesforce objects — it does not support HTTP callouts to external endpoints. The script deploys and works in sandbox because the DataRaptor Remote action fails silently and a cached test response masks the gap. In production, the callout never fires and the downstream Integration Procedure receives an empty response.",
    better_path:
      "Use Integration Procedure HTTP Action elements for all external REST or SOAP callouts. DataRaptor Extract and Load are for Salesforce data operations only (SOQL, DML, object relationships). DataRaptor Remote actions are for calling server-side Apex methods, not external endpoints. Establish a clear tool selection rule in the design: external system → Integration Procedure HTTP Action; Salesforce data → DataRaptor Extract/Load; custom Apex logic → Callable Apex via Integration Procedure.",
    severity: "high",
    components: ["DataRaptor", "IntegrationProcedure", "OmniStudio"],
    tags: ["omni", "dataraptor", "integration-procedure", "callout", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-002",
    title: "OmniScript with no step-level error handling — silent failure on remote call",
    scenario:
      "An OmniScript step calls an Integration Procedure to retrieve account data. The Integration Procedure fails (external API timeout, Apex exception, SOQL error). The OmniScript element receives a null or empty response and has no error handling configured. The user sees a blank form step with no message — the script appears to be loading indefinitely or shows fields with no values. There is no fault path, no error message element, and no logging. Support cannot diagnose the failure because no error was captured.",
    better_path:
      "Every OmniScript step that calls a Remote Action, Integration Procedure, or DataRaptor must have step-level error handling: configure an error message element that displays when the action returns an error flag, map an `errorMessage` output key from the called action, and define a fault navigation path. Integration Procedures should always set a boolean `hasError` and string `errorMessage` in their output map — OmniScript then checks this flag and branches to an error step. Never leave a remote call step without an explicit error branch.",
    severity: "high",
    components: ["OmniScript", "OmniStudio"],
    tags: ["omni", "omniscript", "error-handling", "fault-path", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-003",
    title: "FlexCard with unbounded SOQL data source — N+1 query pattern on list view",
    scenario:
      "A FlexCard list view displays a list of opportunities. Each card row has a child action that fires a separate DataRaptor Extract to retrieve related line items for that opportunity. With 200 visible rows, 200 individual SOQL queries are fired simultaneously. The org hits the per-transaction SOQL limit, all child queries fail, and the list cards render blank. The design was tested with 5 rows in sandbox where the N+1 pattern was not visible. In production with 200 rows, the page is unusable.",
    better_path:
      "Consolidate parent and child data retrieval into a single Integration Procedure that returns all required data in one call. The Integration Procedure queries the parent records and their children together (using a relationship SOQL or two sequential DataRaptor Extracts), assembles the response structure, and returns the full payload to the FlexCard. The FlexCard renders from the pre-assembled data with no per-row queries. For list views, always add an explicit record limit (e.g. 50 records) and pagination — never allow an unbounded result set to drive render.",
    severity: "high",
    components: ["FlexCard", "DataRaptor", "OmniStudio"],
    tags: ["omni", "flexcard", "N+1", "SOQL", "governor-limits", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-004",
    title: "Integration Procedure HTTP Action with no timeout or retry — hang on external latency",
    scenario:
      "An Integration Procedure calls a third-party billing API via an HTTP Action. No timeout is configured on the HTTP Action element. The billing API degrades during peak hours and begins responding in 45 seconds instead of 2 seconds. Every in-flight OmniScript session that reaches the billing step hangs for 45 seconds. Concurrent users pile up. The org's overall performance degrades. There is also no retry logic — a single transient 503 from the billing API aborts the entire Integration Procedure with no recovery attempt.",
    better_path:
      "Set an explicit timeout on every Integration Procedure HTTP Action element — recommended 10 000–20 000 ms depending on the external system's SLA. Configure the error handling path: on timeout or non-200 response, map the error to the output node and set `hasError: true`. For transient failures (5xx, 429), implement a retry element using the Loop and Conditional elements within the Integration Procedure — maximum 3 retries with exponential delay. Document the full error path in the SDD: timeout → retry → dead-letter Platform Event → alert.",
    severity: "high",
    components: ["IntegrationProcedure", "OmniStudio"],
    tags: ["omni", "integration-procedure", "timeout", "retry", "http-action", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-005",
    title: "Callable Apex breaking System.Callable contract — null output and silent failure",
    scenario:
      "A Callable Apex class is called from an Integration Procedure. The `call()` method contains a SOQL query that throws a `QueryException` when the record is not found. The exception is not caught. The OmniStudio framework receives a null output map from the Callable Apex. The Integration Procedure step that called the Apex has no error handling — it proceeds with a null response. A downstream Set Values element attempts to access a key from the null map and throws an NPE. The Integration Procedure fails with a generic error. There is no stack trace in the OmniScript UI and no error logged to the output.",
    better_path:
      "Callable Apex must always return a populated `Map<String, Object>` from the `call()` method — never throw an uncaught exception. Wrap the entire method body in a try/catch. On exception, populate the output map with `hasError: true` and `errorMessage: e.getMessage()` and return it — never rethrow. The `call()` signature must match `System.Callable` exactly: `public Object call(String action, Map<String, Object> args)`. Null-check the `args` map and any expected keys before use. Document the output map contract (keys and types) in the Apex class so Integration Procedure callers know what to expect.",
    severity: "high",
    components: ["CallableApex", "IntegrationProcedure", "OmniStudio"],
    tags: ["omni", "callable-apex", "error-handling", "system-callable", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-006",
    title: "Namespace hardcoded in OmniStudio metadata — deployment failure across orgs",
    scenario:
      "A DataRaptor Extract field mapping references `vlocity_cmt__ProductId__c` directly in the field name. An Integration Procedure property key is named `vlocity_ins__PolicyNumber__c`. These namespace prefixes (`vlocity_cmt`, `vlocity_ins`) are specific to the Vlocity/Industries managed package version installed in the development org. When the metadata is deployed via DataPack to a production org with a different namespace configuration, or to a new org where the managed package has not been installed, all namespace-prefixed field references fail at runtime. The DataRaptor returns null for every mapped field. The failure is silent — no deployment error, only runtime nulls.",
    better_path:
      "Never hardcode namespace prefixes in DataRaptor field mappings, OmniScript element JSON, Integration Procedure property keys, or FlexCard data source configurations. Use the namespace-agnostic field API name where the platform supports it, or configure namespace handling through the OmniStudio namespace settings. Document the namespace strategy in the SDD: specify which managed package version is the deployment dependency and how namespace resolution will be handled in each target org. Include a namespace verification step in the deployment runbook.",
    severity: "high",
    components: ["DataRaptor", "OmniScript", "IntegrationProcedure", "OmniStudio"],
    tags: ["omni", "namespace", "managed-package", "vlocity", "deployment", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-007",
    title: "EPC product hierarchy too deep — configurator performance degradation",
    scenario:
      "An EPC product catalog is modeled with 6 levels of product hierarchy: Portfolio → Category → Sub-category → Product Family → Product → Variant. Each level has its own attributes, eligibility rules, and incompatibility constraints. The product configuration page must traverse all 6 levels to resolve inheritance and evaluate rules. With a full catalog of 800 products, the configuration page takes 9–12 seconds to load. The performance was acceptable in sandbox with 50 products but degrades non-linearly as catalog size grows. Rule evaluation timeout errors begin appearing in production under concurrent load.",
    better_path:
      "Design EPC product hierarchies with a maximum of 4 levels. Beyond 4 levels, the query complexity for attribute inheritance resolution and rule evaluation grows non-linearly with catalog size. Flatten the hierarchy where product differentiation can be captured through attributes rather than additional hierarchy levels. Test the configurator performance with the full production catalog loaded — do not test with a subset. For catalogs projected to exceed 500 products, conduct a configurator load test at design time and document acceptable response time SLAs.",
    severity: "medium",
    components: ["EPC", "ProductCatalog", "OmniStudio"],
    tags: ["omni", "EPC", "product-catalog", "performance", "hierarchy", "sf-omni"],
    source: "sf-omni",
  },
  {
    id: "OMNI-008",
    title: "OmniScript reused across channels without branching — cross-channel regression risk",
    scenario:
      "A single OmniScript is used for both the self-service web portal and the agent desktop channel. The agent desktop requires an internal confirmation step, a notes field, and a supervisor approval flag — none of which are appropriate for the web portal. These elements are added directly to the shared script. The web portal now shows an internal confirmation step to customers. A subsequent change for mobile adds a step that works on mobile but breaks the layout on the agent desktop. All three channels are broken by a change intended for one. There is no branching logic and no channel-aware design.",
    better_path:
      "Define a channel strategy before building OmniScripts. Option A (preferred for significant channel divergence): dedicated OmniScript per channel — each channel owns its flow with no shared state risk. Option B (for scripts that are 80%+ identical): a single base OmniScript with explicit channel branching using Conditional Steps that check a channel context variable passed at launch. Document the branching logic. Any change to the shared script must be regression tested across all channels it serves. Store the channel context variable in the OmniScript launch options and validate its presence on the first step.",
    severity: "medium",
    components: ["OmniScript", "OmniStudio"],
    tags: ["omni", "omniscript", "cross-channel", "branching", "channel-strategy", "sf-omni"],
    source: "sf-omni",
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
    console.error("[seed-omni-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-omni-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of omniFailurePatterns) {
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
  for (const pattern of omniFailurePatterns) {
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
          agent_hints: ["sf-omni"],
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
