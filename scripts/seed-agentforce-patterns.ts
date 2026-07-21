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
      "Topic instructions are written too broadly, allowing the agent to accept inputs and invoke actions outside the intended domain. An agent topic designed for customer service accepts any input and attempts to invoke billing, technical support, and account management actions without guardrails, producing unpredictable responses. In Agent Builder trace output, action selection confidence scores reveal the topic is routing inputs to unintended actions — but this signal is only visible when traces are reviewed during testing. In production, STDM session data shows elevated topic misclassification rates, but without STDM enabled, no signal reaches the team until users report degraded answers.",
    better_path:
      "Write topic instructions with explicit scope boundaries — state what the topic handles AND what it does not handle. Use an exclusion list in the topic instruction. Create a routing topic to direct off-topic requests rather than letting the primary topic attempt resolution. In Testing Center, add out-of-scope test cases for every adjacent topic — verify the routing topic classifies them correctly before go-live. Monitor STDM topic activation logs post-deployment: if topic misclassification rate exceeds 5% of sessions, trigger a topic instruction revision.",
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
      "A single Agentforce topic has more than 5–8 actions assigned. The LLM must select from too large an action set, leading to incorrect action selection, missed invocations, and inconsistent agent behaviour across varied user inputs. In Builder trace output, action selection confidence scores show near-tied rankings across multiple actions — a direct signal of overlapping descriptions. Degrades in production as more actions are added over time without corresponding adversarial testing.",
    better_path:
      "Limit topics to 5 actions maximum. If a topic requires more, split it into focused sub-topics with clearly scoped mandates. Each action's description must be distinct and unambiguous — overlapping descriptions are the primary cause of LLM selection errors. After splitting, review Builder trace action selection rankings: descriptions are well-separated when no two actions score within 10% of each other. Run Testing Center adversarial test cases to confirm action selection accuracy improves after the split.",
    severity: "medium",
    components: ["AgentTopic", "AgentAction", "Agentforce"],
    tags: ["agentforce", "topic-design", "action-catalogue", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-018",
    title: "Missing audit trail configuration",
    scenario:
      "Agentforce agents are deployed without Einstein Trust Layer audit logging enabled and without the Session Trace Data Model (STDM) configured. There is no forensic record of agent inputs, outputs, actions invoked, data accessed, topic activation sequences, or session completion status. Compliance reporting, incident investigation, topic drift detection, and post-go-live debugging are all impossible without this record.",
    better_path:
      "Enable Einstein Trust Layer audit logging and STDM for all Agentforce agents before go-live — both are mandatory in regulated industries. Audit logging captures content compliance (what was said, what data was accessed); STDM captures operational behaviour (topic activation sequence, deliberation turn counts, session completion status). Define log retention policy aligned with compliance requirements. Confirm audit logs capture: user input, agent response, every action invoked, and data fields accessed. Include both configurations in the go-live checklist.",
    severity: "high",
    components: ["EinsteinTrustLayer", "Agentforce"],
    tags: ["agentforce", "audit", "compliance", "observability", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "FP-019",
    title: "Edition and licensing mismatch",
    scenario:
      "The SDD assumes Agentforce features — Agent Studio, Einstein Copilot, Agentforce for Service or Sales, Data Cloud grounding, or specific Einstein Trust Layer capabilities — that are not available in the client's licensed Salesforce edition or purchased add-on SKUs. Additionally, Flex Credit consumption is not estimated, meaning the client's monthly credit allocation may be depleted before month-end once the agent goes live at full volume. Both issues are discovered at UAT or go-live.",
    better_path:
      "Verify every Agentforce feature used against the client's current edition and active SKUs before starting design. Agentforce is add-on based and heavily edition-gated — do not assume availability. Complete the Flex Credit estimation in the Agentforce Grid workbook: monthly conversation volume × credits per conversation, with a 30% first-month buffer. Document all licensing assumptions explicitly in the SDD and obtain written confirmation from the client before the design is approved.",
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
  {
    id: "AGF-001",
    title: "Agent topic scope too broad — precision degradation",
    scenario:
      "An Agentforce topic instruction does not include an explicit exclusion list. As a result, the LLM classifies user inputs from adjacent topics into this topic — an account lookup topic begins receiving billing queries, a scheduling topic begins handling complaints. In STDM session traces, topic misclassification events accumulate, but without STDM enabled, no signal reaches the development team until users report degraded answers. Precision drops gradually as the agent is used across a wider user population with more varied phrasing.",
    better_path:
      "Write topic instructions with a three-part structure: what the topic handles, what it explicitly does NOT handle, and how to route out-of-scope requests. Monitor STDM topic activation logs post-deployment — if a topic's misclassification rate exceeds 5% of sessions, trigger a topic instruction revision. In Testing Center, add out-of-scope test cases for every adjacent topic to catch misclassification before go-live.",
    severity: "medium",
    components: ["AgentTopic", "Agentforce"],
    tags: ["agentforce", "topic-design", "scope", "precision", "STDM", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-002",
    title: "No escalation path — silent session termination",
    scenario:
      "An Agentforce agent has no escalation action and no fallback topic. When a user request is out of scope, the deliberation loop exhausts its budget retrying the same intent classification, then terminates the session with a generic error. The user has no next step and the session shows as an unresolved termination in STDM. Support teams have no visibility into how frequently this occurs because STDM is not enabled. High-value users who hit this are not redirected to a human agent and the organisation has no record of the failed session.",
    better_path:
      "Define a fallback topic and at least one escalation action before build begins. The escalation action must pass the full conversation context to the receiving queue or agent. Configure STDM to flag sessions that end without a clean resolution status — use this as an operational health metric. In Testing Center, include at least one test case per topic that triggers escalation and verify the context handover payload is complete.",
    severity: "high",
    components: ["AgentTopic", "Agentforce"],
    tags: ["agentforce", "escalation", "human-in-the-loop", "fallback", "STDM", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-003",
    title: "Agent action not idempotent — duplicate execution on retry",
    scenario:
      "An Agentforce action that creates a case, sends an email, processes a refund, or inserts a record is invoked twice in the same session because the agent retries on a timeout or the user re-submits the same request in a follow-up message. The action has no idempotency check — no deduplication key, no record existence check before insert. The result is duplicate cases, double emails to customers, or double-processed payments.",
    better_path:
      "Design all state-mutating Agentforce actions to be idempotent. Before executing a create or send operation, check whether an equivalent operation has already been performed in this session using a session-scoped correlation key or a record existence check. For payment and financial actions, implement idempotency at the external system level, not just at the Salesforce layer. Document the idempotency mechanism in the Action Register in the Agentforce Grid workbook.",
    severity: "high",
    components: ["AgentAction", "Agentforce"],
    tags: ["agentforce", "idempotent-action", "duplicate", "action-design", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-004",
    title: "Persona not defined — inconsistent tone breaks user trust",
    scenario:
      "An Agentforce agent is built without a defined persona document. Individual topics are configured by different developers with different tone styles — one uses formal language, another is casual, a third uses terse bullet points. In production, users experience a disjointed agent that feels unreliable. In escalation scenarios, the agent uses clinical error language while the rest of the session was warm and supportive. User trust and CSAT scores fall below baseline.",
    better_path:
      "Define the agent persona — name, role, tone, authority boundary, and prohibited behaviours — before any topic configuration begins. Store the persona definition in the Agentforce Grid workbook. Reference the persona in every topic instruction. Test tone consistency across session types in Testing Center: happy path, error state, escalation, and out-of-scope handling. The escalation handover message must match the agent's established voice.",
    severity: "medium",
    components: ["Agentforce", "AgentTopic"],
    tags: ["agentforce", "persona", "tone", "trust", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-005",
    title: "No Testing Center spec — agent shipped without structured test coverage",
    scenario:
      "An Agentforce agent is shipped with only manual ad-hoc testing performed by the developer in the Builder chat window. No Testing Center YAML specs are written and there is no regression test suite. When topic instructions or action descriptions are modified post-go-live to fix user-reported issues, new failures are introduced in previously working paths that are not detected until users report them again. The team has no automated way to confirm the agent behaves correctly after any configuration change.",
    better_path:
      "Write Testing Center YAML test specifications before build begins — treat them as the agent's acceptance criteria. Minimum coverage: 3 happy-path cases per topic, 2 out-of-scope cases per topic, and 2 adversarial cases per agent. Store specs in version control alongside the agent configuration export. Run the full test suite against every configuration change before promoting to production. Add all user-reported failing inputs as permanent regression test cases.",
    severity: "high",
    components: ["Agentforce", "AgentTopic", "AgentAction"],
    tags: ["agentforce", "Testing Center", "test-coverage", "regression", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-006",
    title: "STDM observability not enabled — no session trace visibility in production",
    scenario:
      "An Agentforce agent is deployed without enabling the Session Trace Data Model (STDM). In production, the team has no visibility into topic misclassification rates, action invocation failures, escalation frequency, deliberation budget consumption, or unexplained session terminations. When users report degraded answers or session drops, there is no forensic data to diagnose the root cause. Issues compound silently until a critical failure occurs that cannot be diagnosed without historical trace data.",
    better_path:
      "Enable STDM for every Agentforce agent before go-live as a non-negotiable gate. Define operational monitoring dashboards using STDM output: track topic misclassification rate, session completion rate, escalation rate, and average deliberation turn count per session. Set alert thresholds: misclassification >5%, session failure rate >2%, deliberation turns >8 in more than 10% of sessions. Include STDM configuration in the go-live checklist alongside audit logging.",
    severity: "high",
    components: ["Agentforce", "EinsteinTrustLayer"],
    tags: ["agentforce", "STDM", "observability", "session-trace", "monitoring", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-007",
    title: "Flex Credit not estimated — licensing cost unknown at design sign-off",
    scenario:
      "An Agentforce implementation is designed and built without estimating Flex Credit consumption. The agent design includes multi-turn conversations, autonomous task completion for high-value actions, and high monthly session volume. The client has a fixed Flex Credit allocation. At go-live, actual credit consumption depletes the monthly allocation within the first 10 days. The agent is throttled or disabled, causing a production incident and a licence renegotiation with Salesforce that delays return-to-service by weeks.",
    better_path:
      "Estimate Flex Credit consumption as part of the design phase before the architecture is finalised. Use the Agentforce Grid workbook Licensing worksheet: document monthly conversation volume forecast, expected deflection rate, average turns per conversation, and credits per conversation type. Apply a 30% buffer for first-month volume spikes. Obtain written confirmation from the Salesforce AE of the credit allocation and overage policy before design sign-off. If the estimate exceeds the allocation, redesign the agent scope before build begins.",
    severity: "high",
    components: ["Agentforce", "Licensing"],
    tags: ["agentforce", "Flex Credit", "licensing", "cost-model", "sf-agentforce"],
    source: "sf-agentforce",
  },
  {
    id: "AGF-008",
    title: "Agent Script subagent count exceeds deliberation budget — Judge timeout risk",
    scenario:
      "An Agent Script or multi-agent pipeline is designed with a high number of subagent calls. Each topic activation, action invocation, and nested subagent call consumes from the session's deliberation budget. A pipeline with 8+ specialist agents, each requiring 2–3 deliberation turns, exhausts the Salesforce-imposed per-session budget mid-flow. The orchestrating agent (Judge or equivalent) times out before producing a synthesis. This pattern was observed in ARBoard's own 13-agent pipeline, which exceeds the Claude Desktop MCP timeout under synchronous execution — an async/polling architecture is the pending resolution per ARCHITECTURE.md.",
    better_path:
      "Count deliberation turns during design, not after build. For each agent in the pipeline, estimate turns per topic activation and per action call, and identify the critical path. Reduce pipeline depth by merging low-value specialist agents or parallelising independent agents where the platform supports it. For pipelines that genuinely require more turns than the synchronous budget allows, implement an async/polling pattern: trigger the pipeline asynchronously, poll for completion, and return results when available. Document the deliberation budget analysis in the Agentforce Grid workbook as a go-live gate.",
    severity: "high",
    components: ["Agentforce", "AgentScript", "AgentTopic"],
    tags: ["agentforce", "subagent", "deliberation-budget", "FSM", "timeout", "sf-agentforce"],
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
