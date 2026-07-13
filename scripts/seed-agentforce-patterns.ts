/**
 * Seed FP-013 to FP-020 (Agentforce failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:agentforce-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const agentforceFailurePatterns = [
  {
    id: "FP-013",
    title: "Over-broad topic scope",
    scenario:
      "Topic instructions are written too broadly, allowing the agent to accept inputs and invoke actions outside the intended domain. An agent topic designed for customer service accepts any input and attempts to invoke billing, technical support, and account management actions without guardrails, producing unpredictable responses.",
    better_path:
      "Write topic instructions with explicit scope boundaries — state what the topic handles AND what it does not handle. Use an exclusion list in the topic instruction. Create a routing topic to direct off-topic requests rather than letting the primary topic attempt resolution.",
    severity: "high",
    components: ["AgentTopic", "Agentforce"],
    tags: ["agentforce", "topic-design", "scope", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-014",
    title: "Missing escalation path",
    scenario:
      "Agentforce agent topics have no defined human-in-the-loop or fallback behaviour. When the agent cannot resolve an intent it loops, returns a generic failure message, or terminates the session with no path to a human agent and no context handover.",
    better_path:
      "Define an escalation action for every topic — transfer to a human agent with full conversation context preserved. Add a fallback topic that captures all unresolvable intents and routes them to a queue or live agent. Test the escalation path explicitly in UAT.",
    severity: "high",
    components: ["AgentTopic", "Agentforce"],
    tags: ["agentforce", "escalation", "human-in-the-loop", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-015",
    title: "Ungrounded agent actions — PII in LLM context without Trust Layer masking",
    scenario:
      "Custom Agentforce actions return raw Salesforce record data — including PII fields such as Tax File Number, Date of Birth, financial balances, or health information — directly into the LLM context without Einstein Trust Layer data masking configured. In regulated industries this is a Privacy Act breach.",
    better_path:
      "Configure Einstein Trust Layer for all agents in regulated contexts. Define data masking rules for every PII field category. Audit each custom action's output fields — only expose what the LLM needs to complete the task. Use field-level security to prevent PII-bearing fields from reaching the action output layer.",
    severity: "critical",
    components: ["EinsteinTrustLayer", "Agentforce", "AgentAction"],
    tags: ["agentforce", "PII", "trust-layer", "compliance", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-016",
    title: "Prompt injection surface",
    scenario:
      "User-supplied input from chat messages, case descriptions, or web form fields is passed directly into Agentforce prompt templates without sanitisation. A malicious user can craft input that overrides agent instructions, causes data exfiltration, or triggers unintended actions.",
    better_path:
      "Never concatenate raw user input into prompt templates. Sanitise and validate inputs at the action boundary before they enter any prompt context. Use parameterised prompt instructions. Apply Einstein Trust Layer input filtering where available. Test adversarial inputs during security review.",
    severity: "critical",
    components: ["PromptTemplate", "Agentforce", "AgentAction"],
    tags: ["agentforce", "prompt-injection", "security", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-017",
    title: "Action catalogue bloat",
    scenario:
      "A single Agentforce topic has more than 5–8 actions assigned. The LLM must select from too large an action set, leading to incorrect action selection, missed invocations, and inconsistent agent behaviour across varied user inputs. Degrades in production as more actions are added over time.",
    better_path:
      "Limit topics to 5 actions maximum. If a topic requires more, split it into focused sub-topics with clearly scoped mandates. Each action's description must be distinct and unambiguous — overlapping descriptions are the primary cause of LLM selection errors. Review action descriptions with adversarial test inputs.",
    severity: "medium",
    components: ["AgentTopic", "AgentAction", "Agentforce"],
    tags: ["agentforce", "topic-design", "action-catalogue", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-018",
    title: "Missing audit trail configuration",
    scenario:
      "Agentforce agents are deployed without Einstein Trust Layer audit logging enabled. There is no forensic record of agent inputs, outputs, actions invoked, or data accessed. Compliance reporting, incident investigation, and debugging are impossible without this record.",
    better_path:
      "Enable Einstein Trust Layer audit logging for all Agentforce agents, mandatory in regulated industries. Define log retention policy aligned with compliance requirements. Confirm logs capture: user input, agent response, every action invoked, data fields accessed, and session metadata. Include audit log review in go-live checklist.",
    severity: "high",
    components: ["EinsteinTrustLayer", "Agentforce"],
    tags: ["agentforce", "audit", "compliance", "observability", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-019",
    title: "Edition and licensing mismatch",
    scenario:
      "The SDD assumes Agentforce features — Agent Studio, Einstein Copilot, Agentforce for Service or Sales, Data Cloud grounding, or specific Einstein Trust Layer capabilities — that are not available in the client's licensed Salesforce edition or purchased add-on SKUs. Discovered at UAT or go-live.",
    better_path:
      "Verify every Agentforce feature used against the client's current edition and active SKUs before starting design. Agentforce is add-on based and heavily edition-gated — do not assume availability. Document licensing assumptions explicitly in the SDD and obtain written confirmation from the client before the design is approved.",
    severity: "high",
    components: ["Agentforce", "Licensing"],
    tags: ["agentforce", "licensing", "edition", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-020",
    title: "Weak confirmation gates on high-consequence actions",
    scenario:
      "High-consequence Agentforce actions — creating cases, updating account records, processing refunds, sending emails or SMS, or modifying financial data — execute immediately on agent decision without requiring explicit user confirmation. Results in unintended data changes or communications reaching customers.",
    better_path:
      "Implement confirmation gates for all destructive or high-value actions. The agent must present the proposed action and its parameters to the user and require explicit approval before execution. Define a classification of high-consequence actions in the topic design specification. Test confirmation gate bypass scenarios during UAT.",
    severity: "high",
    components: ["AgentAction", "Agentforce"],
    tags: ["agentforce", "confirmation-gates", "security", "sf-agentforce"],
    source: "sf-agentforce",
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
    console.error("[seed-agentforce-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-agentforce-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of agentforceFailurePatterns) {
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
  for (const pattern of agentforceFailurePatterns) {
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
          agent_hints: ["sf-agentforce"],
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
