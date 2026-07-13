# Contributing to ARBoard

ARBoard is a deliberative multi-agent architecture review system. Contributions fall into four categories: **new agents**, **skill files**, **failure patterns**, and **domain extensions**. This guide covers each.

---

## Table of contents

1. [Before you start](#before-you-start)
2. [Adding a new specialist agent](#adding-a-new-specialist-agent)
3. [Adding or updating skill files](#adding-or-updating-skill-files)
4. [Adding a failure pattern](#adding-a-failure-pattern)
5. [Adding a new domain](#adding-a-new-domain)
6. [Pull request checklist](#pull-request-checklist)
7. [Things you must never do](#things-you-must-never-do)

---

## Before you start

- Clone the repo and run `npm install`
- Copy `.env.local.example` to `.env.local` and fill in your keys (Anthropic, Supabase, Voyage AI, Jira)
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
  "skillKeywords": ["keyword1", "keyword2", "keyword3"],
  "description": "One sentence describing what this agent reviews."
}
```

**Field reference:**

| Field | Purpose |
|---|---|
| `id` | Canonical agent ID — used in session traces and ADRs. Never change after first commit. |
| `file` | Basename of the TS agent config file in `src/lib/domains/salesforce/agents/` |
| `promptFile` | Basename of the prompt `.md` file in `src/prompts/agents/` |
| `skillKeywords` | `ImpactAnalyser` uses these to decide whether to activate this agent for a given SDD |
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

Create `src/skills/domains/sf-myagent.md` (see [Adding or updating skill files](#adding-or-updating-skill-files)).

After creating the skill file, re-run the embedder so it's retrievable via RAG:
```bash
npx tsx --env-file=.env.local src/scripts/seedEmbeddings.ts
```

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

Every skill file must follow this structure:

```markdown
# [Skill area name]

## Overview
[2-3 sentences describing what this skill covers]

## Mandatory checklist
- [ ] [Check 1] — **CRITICAL**
- [ ] [Check 2] — **HIGH**
- [ ] [Check 3] — **MEDIUM**

## Key patterns
[Content organised by topic]

## Anti-patterns
[What to flag as findings]
```

**Severity rubric:**
- `CRITICAL` — blocks go-live, data loss or security risk
- `HIGH` — must fix before go-live, significant risk
- `MEDIUM` — should fix, technical debt or performance risk
- `LOW` — best practice, advisory only

### After updating a skill file

Skill files are embedded into `grounding_embeddings` via Voyage AI. After updating any skill file, re-run the seeder:

```bash
npx tsx --env-file=.env.local src/scripts/seedEmbeddings.ts
```

This keeps the RAG retrieval layer current. If you skip this step, your updated content won't be retrieved semantically.

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

Then upsert into both `failure_patterns` (for pattern injection in AgentRunner) and `grounding_embeddings` (for RAG retrieval). Add an npm script to `package.json`:

```json
"seed:myagent-patterns": "npx ts-node --project tsconfig.json scripts/seed-myagent-patterns.ts"
```

Run it:
```bash
VOYAGE_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:myagent-patterns
```

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

After adding patterns, add entries to the relevant skill file (`src/skills/domains/sf-myagent.md` or `src/skills/failure-patterns.md`) and re-run the embedder:

```bash
npx tsx --env-file=.env.local src/scripts/seedEmbeddings.ts
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

## Pull request checklist

Before opening a PR, confirm all of the following:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Tested locally with a live NovaPeak session — no regressions in existing agent output
- [ ] If skill files were changed — `seedEmbeddings.ts` has been re-run
- [ ] If a new failure pattern was added — added to both Supabase and `patterns.md`
- [ ] If a new agent was added — manifest entry (`agentManifest.json`), prompt file (`src/prompts/agents/`), agent config TS (`src/lib/domains/salesforce/agents/`), registered in `salesforce/index.ts`, and skill file (`src/skills/domains/`) all present
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

---

## Questions?

Raise an issue in the repo or contact the ARBoard team via the Accenture internal channel.

*ARBoard is built on Next.js 14, TypeScript, Anthropic Claude, Supabase pgvector, and Voyage AI. See `ARCHITECTURE.md` for the full system overview.*
