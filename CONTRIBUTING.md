# Contributing to ARBoard

ARBoard is a deliberative multi-agent architecture review system. Contributions fall into four categories: **new agents**, **skill files**, **failure patterns**, and **domain extensions**. This guide covers each.

---

## Table of contents

1. [Before you start](#before-you-start)
2. [Adding a new specialist agent](#adding-a-new-specialist-agent)
3. [Adding or updating skill files](#adding-or-updating-skill-files)
4. [Adding a failure pattern](#adding-a-failure-pattern)
5. [Adding a new domain](#adding-a-new-domain)
6. [Frontend component structure](#frontend-component-structure)
7. [Adding a new input mode](#adding-a-new-input-mode)
8. [GoalOrchestrator pattern](#goalorchestrator-pattern)
9. [Using the LLM abstraction layer](#using-the-llm-abstraction-layer)
10. [Adding an MCP tool](#adding-an-mcp-tool)
11. [Pull request checklist](#pull-request-checklist)
12. [Things you must never do](#things-you-must-never-do)

---

## Before you start

- Clone the repo and run `npm install`
- Copy `.env.local.example` to `.env.local` and fill in your keys (Anthropic, Supabase, Voyage AI, Jira)
- Set `LLM_PROVIDER=anthropic` in `.env.local` (default; use `bedrock` to route calls through AWS Bedrock — also requires `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Run `npx next dev` and confirm the UI loads at `http://localhost:3000`
- Run `npx tsc --noEmit` — all contributions must pass with zero type errors

All changes go through a pull request. No direct pushes to `main`.

---

## Adding a new specialist agent

ARBoard uses a manifest-driven agent registration system. Adding a new agent requires six steps. Use `sf-profiles-permissions` as a reference implementation.

### Step 1 — Register in the manifest

Open `src/config/agentManifest.json` and add an entry **before** `sf-judge` (keep judge and post-processing agents last):

```json
{
  "id": "sf-myagent",
  "name": "My Specialist Name",
  "model": "haiku",
  "domain": "salesforce",
  "role": "specialist",
  "file": "myagent",
  "promptFile": "sf-myagent",
  "enabled": true,
  "alwaysInclude": false,
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "description": "One sentence describing what this agent reviews."
}
```

**Field reference:**

| Field | Purpose |
|---|---|
| `id` | Canonical agent ID — used in session traces and ADRs. Never change after first commit. |
| `file` | Basename of the TS agent config file in `src/lib/domains/salesforce/agents/` |
| `promptFile` | Basename of the prompt `.md` file in `src/prompts/agents/` |
| `keywords` | `ImpactAnalyser` uses these to decide whether to activate this agent for a given SDD |
| `alwaysInclude` | `true` only for judge, scribe, learner |

**Model guidance:**
- Use `"haiku"` for specialist analysis agents (cost-efficient, fast)
- Use `"sonnet"` for agents requiring deep cross-domain reasoning (Judge)

### Step 2 — Create the system prompt

Create `src/prompts/agents/sf-myagent.md`. The file **must** use exactly these five `##` section headings — the agent config parser (`_sec()`) extracts them by name:

```markdown
> Your role is not to be helpful. Your role is to find problems before they reach production.
> Be adversarial, be specific, be decisive.

## Role
You are the [Specialty] Specialist on the Salesforce Architecture Review Board. Your mandate is to review [what] in the submitted SDD.

You do NOT review [out-of-scope concerns] — those belong to [other agents]. You DO flag when [your domain] creates risk and cross-reference those agents where relevant.

## Expertise
- [Bullet list of domain knowledge areas]

## Guardrails
- NEVER approve a design that [critical failure condition]
- ALWAYS check [mandatory check]
- If the SDD contains no [relevant content], state that clearly as a MUST-FIX
- Be specific: "[Generic finding]" is not a finding. "[Specific finding with pattern code]" is a finding

## Output Format
Structure your review as follows:

[AGENT NAME] ASSESSMENT

Verdict Recommendation: [APPROVE / CONDITIONAL APPROVE / REJECT]

Summary (2–3 sentences)

MUST-FIX FINDINGS (blocks approval)
[XX-001] Short title
Pillar: [Well-Architected Pillar] | Pattern: [pattern code or N/A]
Evidence: [Specific SDD reference]
Risk: [Consequence if not addressed]
Remediation: [Concrete fix]

SHOULD-FIX FINDINGS
[same format]

CONSIDER FINDINGS
[brief bullets]

FINDINGS_SUMMARY_START
- [SEVERITY] Finding (one line)
FINDINGS_SUMMARY_END

---
After your analysis, append a JSON block in this exact format with no text after it:
\`\`\`json
{"findings":[{"category":"","severity":"critical|high|medium|low","component":"","recommendation":""}],"overall_risk":"critical|high|medium|low"}
\`\`\`

## Additional Context
[Failure patterns in scope, domain-specific references, metadata awareness notes]
```

Keep prompts focused. An agent that does one thing well outperforms one that tries to cover everything.

### Step 3 — Create the agent config

Create `src/lib/domains/salesforce/agents/myagent.ts`:

```typescript
import fs from "fs";
import path from "path";
import { createBaseAgent, SPECIALIST_MAX_TOKENS } from "@/lib/domains/base";
import type { AgentConfig } from "@/lib/types";

const _raw = fs.readFileSync(
  path.join(process.cwd(), "src/prompts/agents/sf-myagent.md"),
  "utf-8"
);
const _sec = (h: string): string => {
  const re = new RegExp(
    `## ${h}\\n([\\s\\S]*?)(?=\\n## (?:Role|Expertise|Guardrails|Output Format|Additional Context)|$)`
  );
  return _raw.match(re)?.[1]?.trim() ?? "";
};

export const myAgent: AgentConfig = createBaseAgent({
  maxTokens: SPECIALIST_MAX_TOKENS,
  id: "sf-myagent",
  name: "My Specialist Name",
  role: "My Specialist Name",
  sections: {
    persona: _sec("Role"),
    expertise: _sec("Expertise"),
    guardrails: _sec("Guardrails"),
    format: _sec("Output Format"),
    extra: _sec("Additional Context"),
  },
});
```

The `_sec()` regex extracts each section from the prompt file. The five section names are hardcoded in the regex stop-list — do not rename them.

### Step 4 — Register in salesforce/index.ts

Open `src/lib/domains/salesforce/index.ts` and make two surgical changes:

**Add import** alongside the other agent imports:
```typescript
import { myAgent } from "./agents/myagent";
```

**Add to `_agentLookup`** — the key must match the `file` field in the manifest:
```typescript
"myagent": myAgent,
```

### Step 5 — Create the skill file

Create `src/skills/domains/myagent.md` (no `sf-` prefix — must match the manifest `file` field). See [Adding or updating skill files](#adding-or-updating-skill-files) for structure guidance.

After creating the skill file, seed it into `grounding_embeddings`:
```bash
npm run seed:agent -- sf-myagent
```

This embeds all H2 sections of the skill file and any failure patterns in the database with `source = "sf-myagent"`.

### Step 6 — Test locally

Run `npx tsc --noEmit` — must return zero errors. Then run a full session with a test SDD in Live API mode. Confirm:
- Your agent appears in the ImpactAnalyser agent selection when the SDD contains relevant keywords
- It produces structured output with the `FINDINGS_SUMMARY_START / END` block and JSON tail
- No regressions in other agents' output
- Total session cost does not increase by more than $0.05 per run

---

## Adding or updating skill files

Skill files are the grounding knowledge injected into agent prompts. They live in `src/skills/`.

```
src/skills/
  domains/          # Domain-specific knowledge (one file per agent)
  cross-cutting/    # Concerns that apply across all agents (security, performance, governance)
  patterns.md       # Failure pattern reference (FP-004 → FP-020+)
```

### Format requirements

Skill files use free-form H2 sections organised by topic. Use `src/skills/domains/agentforce.md` or `src/skills/domains/data.md` as reference implementations. The only two required sections are:

```markdown
## MANDATORY CHECK LIST
- [ ] [Non-negotiable check before submitting findings]

## SEVERITY RUBRIC
| Severity | Criteria |
|---|---|
| CRITICAL | [Agent-specific example] |
| HIGH     | [Agent-specific example] |
| MEDIUM   | [Agent-specific example] |
| LOW      | [Agent-specific example] |
```

Between these anchors, organise content into H2 sections by topic (e.g. `## Core design principles`, `## LDV patterns`, `## Common failure modes in SI delivery`). Each H2 section becomes one RAG chunk — keep sections focused so the retriever can return precise context. Aim for 8–12 sections total.

**Severity rubric:**
- `CRITICAL` — security vulnerability, data loss, or compliance breach; blocks go-live
- `HIGH` — significant production risk; must fix before go-live
- `MEDIUM` — technical debt or architectural drift; fix within current release
- `LOW` — best practice deviation; low immediate risk

### After updating a skill file

Skill files are embedded into `grounding_embeddings` via Voyage AI. After creating or updating any agent skill file, re-seed it:

```bash
npm run seed:agent -- sf-myagent
```

This re-embeds all H2 chunks for that agent (upserts on `source_id`, so existing chunks are updated in place). If you skip this step, your updated content won't be retrieved semantically.

To re-seed all skill files at once (e.g. after a bulk update), use:
```bash
npx tsx --env-file=.env.local src/scripts/seedEmbeddings.ts
```

---

## Adding a failure pattern

Failure patterns are the core of ARBoard's institutional knowledge. They represent known SI failure modes with evidence from real engagements.

### Naming convention

- Cross-domain Salesforce patterns: `FP-XXX` (e.g. FP-021). Current highest: **FP-020**.
- Agent-scoped patterns use the agent prefix: `PERM-XXX` (profiles-permissions), `AGENTFORCE-XXX`, `APEX-XXX`, etc.
- New domains: `[DOMAIN]-XXX` (e.g. `MULESOFT-001`)

Use cross-domain `FP-XXX` for patterns that apply to multiple specialist agents. Use an agent-scoped prefix when the pattern is specific to one agent's review domain.

### Adding to the database — use a seed script

Do not insert via the Supabase SQL editor. Instead, create or extend a TypeScript seed script in the `scripts/` directory (see `scripts/seed-perm-patterns.ts` as a reference):

```typescript
const patterns = [
  {
    id: "FP-021",                    // or "MYAGENT-001"
    title: "Short descriptive title",
    scenario: "What the failure looks like in an SDD — specific, not abstract.",
    better_path: "What the delivery team should do instead.",
    severity: "high",                // critical | high | medium | low
    components: ["Apex", "Integration"],
    tags: ["tag1", "tag2", "sf-myagent"],
    source: "sf-myagent",            // agent ID that owns this pattern
  },
];
```

Then upsert into `failure_patterns`. Add an npm script to `package.json`:

```json
"seed:myagent-patterns": "npx ts-node --project tsconfig.json scripts/seed-myagent-patterns.ts"
```

Run the pattern seed first, then run `seed:agent` to embed them into `grounding_embeddings`:
```bash
npm run seed:myagent-patterns   # inserts rows into failure_patterns
npm run seed:agent -- sf-myagent  # embeds skill file + failure patterns into grounding_embeddings
```

`seed:agent` queries `failure_patterns WHERE source = agentId` — so the pattern seed must run before the embed step.

### `failure_patterns` table schema

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | Pattern ID, e.g. `FP-021`, `PERM-001` |
| `title` | text | Short title |
| `scenario` | text | What the failure looks like in delivery |
| `better_path` | text | Remediation guidance |
| `severity` | text | `critical` / `high` / `medium` / `low` |
| `components` | text[] | Salesforce components involved |
| `tags` | text[] | Freeform tags for filtering |
| `source` | text | Agent ID or `"real"` / `"generated"` |

### Critical rule

**Never delete or modify existing failure pattern IDs.** The `failure_patterns` table is append-only. Existing patterns are referenced in past ADRs and session traces. If a pattern needs updating, add a new version and note the supersession in the description.

### Update the reference skill file

After adding patterns, add entries to the relevant skill file (`src/skills/domains/myagent.md` or `src/skills/failure-patterns.md`) and re-seed:

```bash
npm run seed:agent -- sf-myagent
```

---

## Adding a new domain

ARBoard currently supports `salesforce` as its primary domain. To add a new domain (e.g. `mulesoft`, `azure`, `aws`):

### Step 1 — Create domain skill files

Create a directory `src/skills/domains/[domain]/` with at minimum:
- `overview.md` — domain architecture principles
- `patterns.md` — known failure patterns for this domain
- One skill file per specialist agent you intend to add

### Step 2 — Register agents in the manifest

Add agents to `agentManifest.json` with `"domain": "[your-domain]"`.

### Step 3 — Seed embeddings for the new domain

```bash
npx tsx --env-file=.env.local src/scripts/seedEmbeddings.ts
```

### Step 4 — Test with a synthetic SDD

Create a synthetic solution design document for your domain with 3-5 deliberately seeded architectural gaps. Run it through ARBoard and verify the agents detect the seeded gaps. Document the test SDD and expected findings in `tests/eval/`.

---

## Frontend component structure

Forum UI code is split across `src/components/ForumTestUI.tsx` (root) and the `src/components/forum/` subdirectory. When making frontend changes, follow these conventions:

```
src/components/forum/
  types.ts        — All shared TypeScript interfaces and types (AgentOutput, DissentData,
                    PendingEndorsement, UploadResult, etc.). Add new types here, not inline.
  constants.ts    — AGENT_META lookup, ALWAYS_ON_IDS, CLOSING_AGENT_IDS, ARCHITECT_ROLES.
                    Add new agent metadata here when adding agents to the manifest.
  utils.ts        — Pure functions: parseVerdict, parseConfidence, parseJudgeConfidenceLevel,
                    parseHumanJudgementPoints, computeRoi, formatBytes, formatDuration, etc.
                    All parsing helpers live here — do not add parsing logic to ForumTestUI.tsx.
  styles.ts       — Shared inline style tokens (S.label, S.card, etc.). Use these rather than
                    duplicating magic values inline.
  primitives/     — Stateless UI atoms: Chip, ConfidenceBar, SectionDivider, MarkdownOutput.
                    New reusable display-only components go here.
  presession/     — Panels shown before a session starts (e.g. JiraInputPanel). Each panel
                    receives callbacks for how to hand off to the main session flow.
```

`ForumTestUI.tsx` is the root orchestrator — it holds all session state and wires up the sub-panels. Keep business logic out of primitives and presession panels; they should receive data and callbacks as props only.

---

## Adding a new input mode

ARBoard has four input modes: `"text"`, `"document"`, `"debate"`, `"jira"`. Use the `"jira"` mode as the reference implementation for adding a fifth.

**Step 1 — Extend the type**

In `src/components/forum/types.ts`, add the new literal to the `InputMode` union:
```typescript
export type InputMode = "text" | "document" | "debate" | "jira" | "mymode";
```

**Step 2 — Add the input tile**

In `ForumTestUI.tsx`, add a new tile to the input mode selector grid. Follow the pattern of the existing four tiles — each tile sets `setInputMode("mymode")` on click and shows an icon + label.

**Step 3 — Add the pre-session panel (if needed)**

If the mode has a custom pre-session UI (like `JiraInputPanel` for `"jira"` mode), create `src/components/forum/presession/MyModePanel.tsx`. The panel must:
- Accept an `onReady(input: string, context?: Record<string, unknown>) => void` callback
- Not hold session state — hand off to `ForumTestUI` via the callback
- Include `x-arboard-key` on any internal `fetch()` calls

**Step 4 — Wire into ForumOrchestrator (if the mode changes orchestration)**

If the new mode changes how agents run (e.g. skipping certain agents, different prompt injection), add a branch in `ForumOrchestrator.ts`. Follow the `inputMode === "debate"` pattern — check `request.inputMode` and adjust agent behaviour before Phase 1.

**Step 5 — Update agentManifest.json keywords (if applicable)**

If the mode is agent-scoped, ensure the relevant agents have matching `keywords` entries (field name is `keywords`, not `skillKeywords` — see manifest for reference).

---

## GoalOrchestrator pattern

`src/lib/goals/GoalOrchestrator.ts` manages the end-to-end lifecycle for Jira-initiated reviews. Follow this pattern when building any background pipeline that writes to Supabase and updates Jira labels.

**Label lifecycle:**
```
Jira: submitted-for-review
  → GoalOrchestrator.createGoal()
      writes goals row (status: arb-review-in-progress)
      calls updateJiraLabels() to swap label on the Jira ticket
  → GoalOrchestrator.executeGoal()
      runs full ForumOrchestrator pipeline
      on success: updates goals row status to "arb-reviewed",  updates Jira label
      on failure: updates goals row status to "arb-review-failed", writes error_message,
                  increments retry_count, updates Jira label
```

**Key invariant — partial unique index:** The `goals` table has a partial unique index preventing two concurrent active goals for the same `jira_issue_key`. Before triggering, check `fetchPendingGoals()` — if a row already exists with status `arb-review-in-progress`, do not create a duplicate.

**Jira API calls** go through `src/lib/integrations/jira.ts`. Use the exported helpers:
- `getJiraEnv()` — reads and validates `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
- `buildJiraHeaders()` — returns the Basic Auth + content-type header object
- `updateJiraLabels(issueKey, labels)` — PUT to `/rest/api/3/issues/{key}`
- `postJiraComment(issueKey, body)` — POST ADF comment
- `searchJql(jql)` — GET `/rest/api/3/search/jql` (not the legacy `/rest/api/3/search`)

Do not construct Jira HTTP calls inline in route handlers — always go through these helpers.

---

## Using the LLM abstraction layer

All LLM calls must go through `getLLMProvider()` from `@/lib/llm`. Never instantiate `new Anthropic()` directly in route handlers, orchestrators, or agent files — that bypasses the provider abstraction and repeats the module-level client anti-pattern.

**One-shot completion** (ImpactAnalyser, dissent analysis, DocumentChunker pattern):

```typescript
import { getLLMProvider } from "@/lib/llm";

// Mock guard stays in the call site, above the provider
if (mode === "mock") return mockResponse;

const { text, usage } = await getLLMProvider().complete({
  model: "claude-haiku-4-5-20251001",
  maxTokens: 1000,
  system: "Your system prompt",
  messages: [{ role: "user", content: userInput }],
});
```

**Streaming** (AgentRunner pattern):

```typescript
import { getLLMProvider } from "@/lib/llm";
import type { LLMMessage } from "@/lib/llm";

const userContent: LLMMessage["content"] = hasImages
  ? [/* image + text blocks */]
  : plainTextInput;

for await (const chunk of getLLMProvider().stream({
  model: agent.model,
  maxTokens: agent.maxTokens,
  system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: userContent }],
})) {
  if (typeof chunk === "string") {
    yield chunk;          // text token
  } else {
    yield chunk;          // { __usage: LLMUsage } — terminal sentinel, always last
  }
}
```

**Key rules:**
- `AnthropicProvider` lazy-inits the Anthropic client inside each call — never at module level.
- The `{ __usage }` sentinel is the final item yielded by `stream()` — consumers distinguish it from text tokens with `typeof chunk === "string"`.
- `complete()` returns `{ text: "", usage }` (not an error) when the model returns no text block — check `!text` and throw/handle explicitly if empty is invalid for your use case.
- `LLM_PROVIDER` env var selects the implementation (default: `anthropic`).

---

## Adding an MCP tool

The MCP server lives in `src/app/api/mcp/route.ts`. It is a stateless HTTP server — no SSE transport, no session state. Clients POST `{ "method": "tools/list" }` or `{ "method": "tools/call", "params": { "name": "...", "arguments": {...} } }` and block until the response is ready.

**Auth:** The MCP endpoint uses `requireApiKey` (`x-arboard-key` header), not `validateExternalApiKey`. MCP clients configure the header in `mcp-config.json`. Do not switch to `validateExternalApiKey` — MCP clients do not have Supabase `api_keys` rows.

**To add a new MCP tool:**

1. Add the tool definition to `TOOL_DEFINITIONS` in `route.ts` — follow the existing `inputSchema` shape.
2. Add a handler function `callMyTool(args)` in the same file. Keep it focused: one function per tool.
3. Add a dispatch case in the `tools/call` block:
   ```typescript
   if (toolName === 'my_tool') return await callMyTool(args)
   ```
4. Update `MCP.md` with the new tool's input/output spec and an example.

**Key constraints:**
- `maxDuration` is 300s — the full agent pipeline takes 60–180s in live mode. Do not add tools that require longer timeouts without adjusting this.
- Tools that drive `ForumOrchestrator.streamForum` must consume the full async generator — do not break early or the session telemetry write in `saveADR` will not complete.
- The `pending_endorsement` SSE event carries the final parsed verdict, confidence level, and must-fix items. Prefer consuming this event over re-parsing judge content.

---

## Pull request checklist

Before opening a PR, confirm all of the following:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Tested locally with a live NovaPeak session — no regressions in existing agent output
- [ ] If skill files were changed — `npm run seed:agent -- <agent-id>` has been run
- [ ] If a new failure pattern was added — seed script run (`seed:myagent-patterns`), then `seed:agent` run to embed
- [ ] If a new agent was added — manifest entry (`agentManifest.json`), prompt file (`src/prompts/agents/`), agent config TS (`src/lib/domains/salesforce/agents/`), registered in `salesforce/index.ts`, and skill file (`src/skills/domains/`) all present
- [ ] If a new frontend `fetch()` to any `/api/*` route was added — confirm it includes `'x-arboard-key': process.env.NEXT_PUBLIC_ARBOARD_API_KEY ?? ''` in the headers (GET and POST). Missing this header returns 401.
- [ ] If a new input mode was added — `InputMode` union updated in `forum/types.ts`, tile added to selector, pre-session panel in `forum/presession/` if required
- [ ] If a Supabase schema was changed — migration file added to `supabase/migrations/` and `goals` label lifecycle documented if a new status value was introduced
- [ ] If any Jira API calls were added — use helpers from `src/lib/integrations/jira.ts` (not inline fetch); use `/rest/api/3/search/jql` not the legacy search endpoint
- [ ] If any LLM calls were added — use `getLLMProvider()` from `@/lib/llm`, not `new Anthropic()` directly; mock guard lives in the call site above the provider; no SDK clients constructed at module level
- [ ] If adding a new LLM provider — implement `LLMProvider` interface in `src/lib/llm/`, add case to `getLLMProvider()` factory in `index.ts`, add model ID mapping if the provider uses different ID formats than Anthropic's
- [ ] If a new MCP tool was added — tool definition added to `TOOL_DEFINITIONS` in `src/app/api/mcp/route.ts`, handler function added, `MCP.md` updated with input/output spec
- [ ] PR description explains what changed and why
- [ ] No secrets, API keys, or `.env.local` contents committed

---

## Things you must never do

These rules exist to protect the integrity of ARBoard's institutional knowledge:

| Rule | Reason |
|------|--------|
| Never delete from `failure_patterns` table | Past ADRs and session traces reference pattern IDs |
| Never delete from `grounding_embeddings` table | Breaks RAG retrieval for historical content |
| Never modify `agentManifest.json` IDs | Agent IDs are referenced in session traces and observability |
| Never rename `_agentLookup` keys in `salesforce/index.ts` without updating the `file` field in the manifest | Key mismatch silently drops the agent from every session |
| Never push directly to `main` | All changes via PR with at least one review |
| Never commit `.env.local` | Contains API keys — use `.env.local.example` for documentation |
| Never change Judge agent prompt without running eval suite | Judge is the arbitration layer — prompt drift breaks verdict quality |
| Never add a frontend `fetch()` to `/api/*` without the `x-arboard-key` header | `requireApiKey` middleware returns 401; silent failure in the UI with no visible error |
| Never include skipped agent output in the dissent analysis input | In document-upload mode, `designerOutput` is set to the raw SDD text — passing it to the dissent analyser under the designer's name causes the LLM to hallucinate a fabricated dissent opinion from document content. The `designerSkipped` flag in `ForumOrchestrator.ts` guards this. |
| Never call `new Anthropic()` directly in route handlers, orchestrators, or agent files | All LLM calls go through `getLLMProvider()` in `@/lib/llm`. Direct SDK instantiation bypasses the provider abstraction and makes provider swaps impossible. |
| Never construct SDK clients (Anthropic, Supabase) at module level | Module-level clients are instantiated at import time, before env vars are loaded in test/edge environments. Always lazy-init inside functions. `DocumentChunker.ts` violated this and was corrected in the LLM abstraction migration. |

---

## Questions?

Raise an issue in the repo or contact the ARBoard team via the Accenture internal channel.

*ARBoard is built on Next.js 14, TypeScript, Anthropic Claude, Supabase pgvector, and Voyage AI. See `ARCHITECTURE.md` for the full system overview.*
