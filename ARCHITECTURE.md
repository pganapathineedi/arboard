# ARBoard — Architecture Documentation

> AI-powered Salesforce Architecture Review Board  
> Maintainer: Rama Ganapathi, Accenture Australia  
> Repo: github.com/pganapathineedi/arboard (private)  
> Deployment: https://arboard.vercel.app

---

## Overview

ARBoard automates the Salesforce Architecture Review Board process using a multi-agent AI deliberation system. Architects upload a Solution Design Document (SDD); nine specialist agents independently assess the design against Salesforce best practices, SI failure patterns, and prior review history, then produce formal Architecture Decision Records (ADRs) and a binding verdict.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Backend | Next.js API routes (Edge-compatible) |
| AI | Anthropic Claude Sonnet (claude-sonnet-4-6) |
| Operational store | Supabase (ap-southeast-2, project: movikzimbrcmiwahyxiv) |
| ADR store | Jira (mbapps.atlassian.net, project: ARBOARD) |
| Deployment | Vercel |
| Org connectivity | jsforce (Salesforce REST API fallback) |

---

## Agent Roster

Nine specialist agents run sequentially. Each receives the SDD, a domain-specific system prompt, and injected context from all four grounding layers.

| Agent ID | Domain | Key Concern |
|---|---|---|
| sf-designer | Solution design | Architectural fit, scalability |
| sf-apex | Apex code | Governor limits, async patterns |
| sf-lwc | LWC | Component design, performance |
| sf-flow | Flow | Bulkification, error handling |
| sf-omniStudio | OmniStudio | Vlocity best practices |
| sf-integration | Integration | API design, error recovery |
| sf-patterns | Architecture patterns | Anti-patterns, technical debt |
| sf-data | Data architecture | Data model, sharing model |
| sf-judge | Judge | Cross-agent synthesis, binding verdict |

Supporting agents: `sf-scribe` (ADR formatting), `sf-learner` (org intelligence).

---

## Four-Layer Agent Grounding Architecture

Every agent prompt is grounded in four layers, injected in order:

```
Layer 1 — Base model knowledge
          Claude Sonnet's training data (Salesforce docs, best practices)

Layer 2 — Static Well-Architected principles
          Hardcoded Salesforce Well-Architected Framework rules per domain

Layer 3 — SI failure pattern library
          Dynamic injection from Supabase (FP-004 through FP-007)
          Patterns derived from real SI delivery failures
          Injected per-agent based on domain relevance

Layer 4 — Cross-session Jira memory
          Top 5 relevant prior ADRs fetched from Jira via JQL
          Scored by keyword overlap with current requirement
          Injected via contextInjector.ts → buildAllAgentMemoryBlocks()
```

### Layer 4 Reconciliation Directive (active)

Agents are instructed to reconcile current findings against prior ADRs:

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

### ADR-003 — Four-layer grounding over RAG
pgvector RAG evaluated and deferred post-demo. Four-layer deterministic injection chosen for predictability, auditability, and demo stability. RAG remains a future enhancement.

### ADR-004 — jsforce fallback for Salesforce org connectivity
Salesforce cloud-hosted MCP gateway requires Enterprise/Production org with Agentforce licensing. Developer Edition orgs are blocked. jsforce REST API used as fallback for org metadata retrieval.

### ADR-005 — Mock/Live API toggle
Dual API key environment pattern (`ANTHROPIC_API_KEY_MOCK` / `ANTHROPIC_API_KEY_REAL`) preserves demo safety. Mock mode returns cached responses; live mode uses real Anthropic API.

---

## Data Flow

```
User uploads SDD
       ↓
ForumOrchestrator.ts
  ├── retrieveMemory()          — Jira JQL fetch, relevance scoring
  ├── loadFailurePatterns()     — Supabase FP library fetch
  └── buildAllAgentMemoryBlocks() — Layer 3+4 context assembly
       ↓
Agent pipeline (sequential, sf-designer → sf-judge)
  Each agent receives:
  - SDD content
  - Domain system prompt
  - SI failure patterns (domain-filtered)
  - Prior ADR context (top 5 by relevance)
       ↓
sf-scribe → formats ADRs
sf-judge  → binding verdict
       ↓
Jira ticket creation (project: ARBOARD)
Supabase audit log
```

---

## SI Failure Pattern Library

Stored in Supabase. Injected per agent based on domain mapping.

| Pattern | Description |
|---|---|
| FP-004 | Integration without circuit breaker |
| FP-005 | Apex DML inside loops |
| FP-006 | Flow without bulkification |
| FP-007 | OmniStudio without caching strategy |

---

## Deferred / Future

- **pgvector RAG** — semantic retrieval over ADR history (post-demo)
- **Prompt caching** — Anthropic prompt caching for repeated system prompts
- **Rebuttal round** — second agent pass where agents challenge each other's verdicts
- **Longitudinal contradiction scoring** — aggregate PERSISTS/ESCALATED trends across sessions

---

## Repository Structure (key files)

```
src/
  lib/
    orchestrator/
      ForumOrchestrator.ts     — main session orchestration
    memory/
      jiraMemoryRetriever.ts   — Jira JQL fetch + relevance scoring
      contextInjector.ts       — Layer 3+4 prompt assembly
    agents/                    — agent system prompts
  app/
    api/
      forum/route.ts           — API entry point
```

---

*Last updated: June 2026*
