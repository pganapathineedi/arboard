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

ARBoard uses a manifest-driven agent registration system. Adding a new agent requires four steps.

### Step 1 — Register in the manifest

Open `src/config/agentManifest.json` and add an entry:

```json
{
  "id": "sf-myagent",
  "name": "My Specialist Name",
  "model": "haiku",
  "domain": "salesforce",
  "role": "specialist",
  "skillKeywords": ["keyword1", "keyword2"],
  "description": "One sentence describing what this agent reviews."
}
```

**Model guidance:**
- Use `"haiku"` for lightweight analysis agents
- Use `"sonnet"` for agents requiring deep reasoning (Judge, complex specialists)
- Keep cost in mind — every agent runs on every relevant session

### Step 2 — Create the system prompt

Create `src/prompts/sf-myagent.md`. Follow this structure:

```markdown
# [Agent Name]

## Role
You are a Salesforce [specialty] specialist on the Architecture Review Board.

## Responsibilities
- [What this agent looks for]
- [What failure modes it detects]

## Output format
Return your findings as:
**FINDING:** [description]
**SEVERITY:** CRITICAL | HIGH | MEDIUM | LOW
**RECOMMENDATION:** [what to fix]

## Checklist
- [ ] [Mandatory check 1]
- [ ] [Mandatory check 2]
```

Keep prompts focused. An agent that does one thing well outperforms one that tries to cover everything.

### Step 3 — Create the skill file

Create `src/skills/domains/sf-myagent.md` (see [Adding or updating skill files](#adding-or-updating-skill-files)).

### Step 4 — Test locally

Run a full session with NovaPeak SDD in Live API mode. Confirm:
- Your agent appears in the ImpactAnalyser agent selection
- It produces structured output matching the format in your prompt
- No TypeScript errors (`npx tsc --noEmit`)
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

Failure patterns (FPs) are the core of ARBoard's institutional knowledge. They represent known SI failure modes with evidence from real engagements.

### Naming convention

- Salesforce patterns: `FP-XXX` (e.g. FP-021)
- Agentforce patterns: `AGENTFORCE-XXX` (e.g. AGENTFORCE-005)
- New domains: `[DOMAIN]-XXX` (e.g. `MULESOFT-001`)

Current highest FP number: **FP-020**. Next available: **FP-021**.

### Adding to the database

Run this SQL in the Supabase dashboard SQL editor:

```sql
INSERT INTO failure_patterns (
  pattern_id,
  domain,
  title,
  description,
  severity,
  agent_hints,
  remediation
) VALUES (
  'FP-021',
  'salesforce',
  'Short descriptive title',
  'Detailed description of the failure mode and when it occurs.',
  'HIGH',
  ARRAY['sf-apex', 'sf-integration'],  -- which agents should flag this
  'What the delivery team should do to remediate.'
);
```

### Critical rule

**Never delete or modify existing failure pattern IDs.** The `failure_patterns` table is append-only. Existing patterns may be referenced in past ADRs and session traces. If a pattern needs updating, add a new version (e.g. FP-021 supersedes FP-007) and note the relationship in the description.

### Update patterns.md

After adding to the database, add the pattern to `src/skills/domains/patterns.md` and re-run the seeder so it gets embedded into `grounding_embeddings`.

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
- [ ] If a new agent was added — manifest entry, prompt file, and skill file all present
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
| Never push directly to `main` | All changes via PR with at least one review |
| Never commit `.env.local` | Contains API keys — use `.env.local.example` for documentation |
| Never change Judge agent prompt without running eval suite | Judge is the arbitration layer — prompt drift breaks verdict quality |

---

## Questions?

Raise an issue in the repo or contact the ARBoard team via the Accenture internal channel.

*ARBoard is built on Next.js 14, TypeScript, Anthropic Claude, Supabase pgvector, and Voyage AI. See `docs/architecture.md` for the full system overview.*
