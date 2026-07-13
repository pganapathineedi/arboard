# ARBoard — Architecture Documentation

> AI-powered Salesforce Architecture Review Board  
> Maintainer: Rama Ganapathi, Accenture Australia  
> Repo: github.com/pganapathineedi/arboard (private)  
> Deployment: https://arboard.vercel.app

---

## Overview

ARBoard automates the Salesforce Architecture Review Board process using a multi-agent AI deliberation system. Architects upload a Solution Design Document (SDD); specialist agents independently assess the design against Salesforce best practices, SI failure patterns, and prior review history, then produce formal Architecture Decision Records (ADRs) and a binding verdict.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Backend | Next.js API routes (Edge-compatible) |
| AI | Anthropic Claude (claude-sonnet-4-6) with prompt caching |
| Embeddings | Voyage AI (voyage-code-3, 1024-dim) |
| Operational store | Supabase (ap-southeast-2, project: movikzimbrcmiwahyxiv) |
| ADR store | Jira (mbapps.atlassian.net, project: ARBOARD) |
| Deployment | Vercel |
| Org connectivity | jsforce (Salesforce REST API fallback) |

---

## Agent Roster

Specialist agents run sequentially. Each receives the SDD, a domain-specific system prompt, and injected context from all grounding layers.

| Agent ID | Domain | Key Concern |
|---|---|---|
| sf-designer | Solution design | Architectural fit, scalability |
| sf-apex | Apex code | Governor limits, async patterns |
| sf-lwc | LWC | Component design, performance |
| sf-flow | Flow | Bulkification, error handling |
| sf-omni | OmniStudio | Vlocity best practices |
| sf-integration | Integration | API design, error recovery |
| sf-patterns | Architecture patterns | Anti-patterns, technical debt |
| sf-data | Data architecture | Data model, sharing model |
| sf-agentforce | Agentforce | Topic design, ETL, escalation, licensing |
| sf-profiles-permissions | Profiles & Permissions | OWD/sharing, FLS, guest user, PSG architecture |
| sf-judge | Judge | Cross-agent synthesis, binding verdict |

Supporting agents: `sf-scribe` (ADR formatting), `sf-learner` (org intelligence capture).

Agent selection is dynamic: `ImpactAnalyser` scores the SDD against each agent's `skillKeywords` in `agentManifest.json` and activates only relevant specialists. `sf-judge`, `sf-scribe`, and `sf-learner` are always-on (`alwaysInclude: true`).

---

## Seven-Layer Agent Grounding Architecture

Every agent prompt is grounded in seven layers, assembled in order before the agent runs:

```
Layer 1 — Base model knowledge
          Claude Sonnet's training data (Salesforce docs, best practices)

Layer 2 — Domain system prompt
          Per-agent .md prompt file with Well-Architected Framework rules
          and domain-specific review checklist

Layer 3 — SI failure pattern library
          Dynamic injection from Supabase `failure_patterns` table
          Patterns derived from real SI delivery failures (FP-004 → FP-020)
          Domain-filtered per agent in AgentRunner.ts

Layer 4 — Skill injection (keyword-triggered)
          Domain skill: src/skills/domains/<agent>.md
          Cross-cutting skills: src/skills/cross-cutting/*.md
          Triggered by keyword match against SDD text
          Loaded by skillLoader.ts → loadDomainSkill() + loadCrossCuttingSkills()

Layer 5 — Semantic RAG  ← shipped July 2026
          SDD text embedded via Voyage AI voyage-code-3
          pgvector cosine similarity search over `grounding_embeddings` (81 chunks)
          Top-5 chunks appended under ## Semantically Retrieved Grounding
          Implemented in src/lib/rag/ragRetriever.ts

Layer 6 — Org learnings  ← now via RAG (July 2026)
          Cross-session learnings captured by sf-learner, persisted to
          `org_learnings` table, and auto-embedded into `grounding_embeddings`
          (content_type: org_learning) on every insert via learnerPersist.ts.
          Retrieved at query time via pgvector alongside skill chunks.
          Direct domain-filter query (retrieveOrgLearnings) superseded.

Layer 7 — Prior ADR context  ← now via RAG (July 2026)
          Jira ADRs (project: ARBOARD) embedded into `grounding_embeddings`
          (content_type: jira_adr) via seedJiraADRs.ts; auto-embedded on
          every new createADRIssue() call. Retrieved via pgvector at query
          time. Jira JQL live-fetch (jiraMemoryRetriever.ts) superseded.
```

### Prior ADR Reconciliation Directive (active)

When prior ADRs are present, agents reconcile current findings:

```
1. Complete independent assessment first
2. For each prior ADR: RESOLVED | PERSISTS | ESCALATED | NOT APPLICABLE — <reason>
3. If verdict contradicts a prior APPROVED decision:
   CONTRADICTION: [JIRA-KEY] — <what changed and why>
```

---

## Key Architectural Decisions

### ADR-001 — Jira as client-facing ADR store
Jira chosen over Supabase for ADR storage to align with existing client SDLC tooling. Supabase used as SI-facing operational store only.

### ADR-002 — Sequential agent debate preserved
Parallel agent execution was evaluated and rejected. Sequential ordering preserves output quality — later agents build on prior context, producing more coherent cross-domain verdicts.

### ADR-003 — Semantic RAG shipped (July 2026)
pgvector RAG was deferred post-demo in favour of deterministic four-layer injection. As of July 2026, RAG is active: SDD text is embedded via Voyage AI `voyage-code-3`, queried against `grounding_embeddings` (81 chunks from skill files and failure patterns), and injected as Layer 5 grounding. Deterministic layers 1–4 are preserved unchanged.

### ADR-004 — Unified RAG store for all grounding sources (July 2026)
Org learnings and Jira ADRs are now embedded into `grounding_embeddings` alongside skills and failure patterns. The Jira JQL live-fetch (`jiraMemoryRetriever.ts`) and the domain-scoped org learnings query (`orgLearningsRetriever.ts`) are superseded. All four grounding layers are now retrieved in a single pgvector similarity pass at query time, reducing per-session latency and eliminating the Jira API round-trip from the hot path. Auto-embed hooks in `learnerPersist.ts` and `createADRIssue()` keep the store current without manual re-seeding.

### ADR-005 — jsforce fallback for Salesforce org connectivity
Salesforce cloud-hosted MCP gateway requires Enterprise/Production org with Agentforce licensing. Developer Edition orgs are blocked. jsforce REST API used as fallback for org metadata retrieval.

### ADR-006 — Mock/Live API toggle
Dual API key environment pattern (`ANTHROPIC_API_KEY_MOCK` / `ANTHROPIC_API_KEY_REAL`) preserves demo safety. Mock mode returns cached responses; live mode uses real Anthropic API.

### ADR-007 — Prompt caching enabled (shipped)
Anthropic prompt caching (`cache_control: ephemeral`) applied to system prompts in AgentRunner. Cache hit/miss metrics tracked in `UsageData` and surfaced in the session drawer UI.

---

## Data Flow

```
User uploads SDD
       ↓
ImpactAnalyser.analyse()
  └── scores SDD against domain keywords → selects active agents
       ↓
ForumOrchestrator.ts
  ├── loadCrossCuttingSkills()       — keyword-matched cross-cutting skill .md files
  │     └── retrieveRelevantChunks()  — Voyage AI embed → pgvector → grounding_embeddings
  │                                     (returns skills + failure patterns + org learnings
  │                                      + prior Jira ADRs in a single similarity pass)
  ├── loadDomainSkill()              — per-agent domain skill .md
  └── [optional] fetchTicket()       — prior rejected ADR for re-submission context
       ↓
       [superseded — no longer called]
       retrieveMemory()              — Jira JQL live-fetch (jiraMemoryRetriever.ts)
       retrieveOrgLearnings()        — direct Supabase org_learnings query
       Both replaced by pgvector RAG over grounding_embeddings
       ↓
Agent pipeline (sequential: sf-designer → specialists → sf-judge)
  Each agent (AgentRunner.ts) receives:
  ├── SDD content
  ├── Domain system prompt (Layer 2)
  ├── SI failure patterns (Layer 3, domain-filtered from Supabase)
  └── RAG chunks (Layers 4–7): skills + failure patterns + org learnings + prior ADRs
       ↓
sf-scribe  → formats ADRs as Jira ADF
sf-judge   → binding verdict (APPROVED / NOT APPROVED / CONDITIONAL)
sf-learner → extracts org learnings → persists to Supabase org_learnings
             → auto-embeds each row into grounding_embeddings (fire-and-forget)
       ↓
Jira ticket creation (project: ARBOARD)
  → auto-embeds new ADR into grounding_embeddings (fire-and-forget)
Supabase session telemetry (sessions + signoffs tables)
```

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `failure_patterns` | SI failure pattern library. Agent-scoped sources: FP-004–FP-012 (`sf-patterns`), FP-013–FP-020 (`sf-agentforce`), PERM-001–PERM-008 (`sf-profiles-permissions`). Append-only — IDs referenced in past ADRs. |
| `grounding_embeddings` | Unified RAG store (voyage-code-3, 1024-dim). content_type values: `skill`, `failure_pattern` (from seedEmbeddings.ts), `org_learning` (from seedOrgLearnings.ts + learnerPersist.ts auto-embed), `jira_adr` (from seedJiraADRs.ts + createADRIssue auto-embed) |
| `org_learnings` | Cross-session learnings captured by sf-learner — source of truth; embeddings mirrored into grounding_embeddings |
| `sessions` | Session telemetry — tokens, cost, duration, model, agent count |
| `signoffs` | Per-agent verdict records tied to session |

---

## Embedding Pipeline

The `grounding_embeddings` table is populated from four sources:

**Offline seed scripts** (run manually after bulk changes):

```
src/scripts/seedEmbeddings.ts       — skill .md files + failure-patterns.md
  src/skills/**/*.md + failure-patterns.md
         ↓ chunkByH2() / chunkFailurePatterns()
         ↓ Voyage AI voyage-code-3 (input_type: document)
         ↓ grounding_embeddings (content_type: skill | failure_pattern)

src/scripts/seedOrgLearnings.ts     — all rows from org_learnings table
  org_learnings.*
         ↓ Voyage AI voyage-code-3
         ↓ grounding_embeddings (content_type: org_learning, source_id: org_learning_{id})

src/scripts/seedJiraADRs.ts         — all real ADRs from Jira project ARBOARD
  Jira REST API (project=ARBOARD, maxResults=50)
         ↓ extractADFText() → plain text, truncated to 8000 chars
         ↓ Voyage AI voyage-code-3
         ↓ grounding_embeddings (content_type: jira_adr, source_id: jira_adr_{key})

scripts/seed-perm-patterns.ts       — PERM-001–PERM-008 (Profiles & Permissions patterns)
  permFailurePatterns[]
         ↓ upsert → failure_patterns (onConflict: id)
         ↓ Voyage AI voyage-code-3 (title + scenario + better_path combined)
         ↓ grounding_embeddings (content_type: failure_pattern, source_id: PERM-00X)
  Run: npm run seed:perm-patterns

scripts/seed-agentforce-patterns.ts — FP-013–FP-020 (Agentforce patterns)
  agentforceFailurePatterns[]
         ↓ upsert → failure_patterns (onConflict: id)
         ↓ Voyage AI voyage-code-3 (title + scenario + better_path combined)
         ↓ grounding_embeddings (content_type: failure_pattern, source_id: FP-0XX)
  Run: npm run seed:agentforce-patterns
```

**Generic per-agent seeder** (primary workflow for new agents):

```
scripts/seed-agent.ts               — seeds ONE agent's skill file + failure patterns
  Usage: npm run seed:agent -- <agent-id>
  1. Reads agent entry from src/config/agentManifest.json
  2. Resolves src/skills/domains/[entry.file].md — chunks by H2, embeds each chunk
     → grounding_embeddings (content_type: skill, source_id: [agentId]-[chunkIndex])
  3. Queries failure_patterns WHERE source = agentId — embeds each pattern
     → grounding_embeddings (content_type: failure_pattern, source_id: pattern.id)
  Run after: creating/updating a skill file OR seeding new failure patterns for an agent
```

**Auto-embed hooks** (fire-and-forget, run on every session):

```
learnerPersist.ts                   — after sf-learner inserts into org_learnings
  new org_learning row
         ↓ Voyage AI voyage-code-3
         ↓ grounding_embeddings upsert (source_id: org_learning_{id})

jira.ts createADRIssue()            — after a new Jira ADR ticket is created
  new Jira issue key + ADF content
         ↓ extractADFText(buildADF(params)), truncated to 8000 chars
         ↓ Voyage AI voyage-code-3
         ↓ grounding_embeddings upsert (source_id: jira_adr_{key})
```

At query time `ragRetriever.ts` embeds the SDD (`input_type: query`) and runs pgvector cosine similarity via the `match_grounding_chunks` Postgres function, returning the top-K chunks across all content types in a single pass.

---

## Repository Structure (key files)

```
src/
  config/
    agentManifest.json           — agent registry: IDs, names, skillKeywords, enabled flags
  lib/
    orchestrator/
      ForumOrchestrator.ts       — main session orchestration, grounding assembly
    agents/
      AgentRunner.ts             — per-agent execution, failure pattern injection, prompt caching
    config/
      manifestLoader.ts          — reads agentManifest.json, filters enabled agents
    rag/
      ragRetriever.ts            — Voyage AI embed → pgvector similarity search
    skills/
      skillLoader.ts             — domain + cross-cutting skill injection
    memory/
      jiraMemoryRetriever.ts     — Jira JQL fetch + relevance scoring [SUPERSEDED BY RAG]
      contextInjector.ts         — prompt assembly helpers
      orgLearningsRetriever.ts   — Supabase org learnings fetch [SUPERSEDED BY RAG]
    patternRetrieval.ts          — Supabase failure pattern fetch + formatting
    analysis/
      ImpactAnalyser.ts          — agent selection scoring (reads skillKeywords from manifest)
    supabase/
      client.ts                  — lazy singleton Supabase client
    domains/
      salesforce/
        index.ts                 — domain config, _agentLookup, getEnabledAgents() wiring
        agents/                  — one .ts file per agent (createBaseAgent + _sec() prompt parser)
  prompts/
    agents/                      — per-agent system prompt .md files (## Role/Expertise/Guardrails/…)
  skills/
    domains/                     — per-agent grounding knowledge (.md)
    cross-cutting/               — keyword-triggered architecture skills (.md)
    failure-patterns.md          — SI failure pattern source (chunked for RAG)
  scripts/
    seedEmbeddings.ts            — offline embed: skill .md files + failure patterns
    seedOrgLearnings.ts          — offline embed: all org_learnings rows
    seedJiraADRs.ts              — offline embed: all real Jira ADRs (project: ARBOARD)
  app/
    api/
      forum/route.ts             — streaming API entry point
scripts/                         — root-level seed scripts (agent-scoped pattern seeders + generic seeder)
  seed-agent.ts                  — generic per-agent seeder: skill file chunks + failure patterns (primary workflow)
  seed-perm-patterns.ts          — seeds PERM-001–PERM-008 into failure_patterns + grounding_embeddings
  seed-agentforce-patterns.ts    — seeds FP-013–FP-020 into failure_patterns + grounding_embeddings
  update-fp-sources.ts           — one-off migration: sets source field on FP-004–FP-020 to agent IDs
supabase/
  migrations/                    — schema migrations
```

---

## Deferred / Future

- **Rebuttal round** — second agent pass where agents challenge each other's verdicts
- **Longitudinal contradiction scoring** — aggregate PERSISTS/ESCALATED trends across sessions

---

*Last updated: July 2026*
