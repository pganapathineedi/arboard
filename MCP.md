# ARBoard MCP Server

ARBoard exposes its architecture review capability as a stateless HTTP MCP server at `/api/mcp`.

## Authentication

All requests require the `x-arboard-key` header:

```
x-arboard-key: <your-arboard-api-key>
```

The key is the value of `ARBOARD_API_KEY` on the server (same key used by the ARBoard web UI).

---

## Available Tools

### `review_document`

Submit a Salesforce solution design document for multi-agent architecture review.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | Full text of the solution design document |
| `requirement` | string | No | Specific requirement or focus area |
| `mode` | `"real"` \| `"mock"` | No | `real` = live Claude agents (default), `mock` = fast test mode |
| `review_mode` | `"full"` \| `"lean"` | No | `full` = complete multi-agent deliberation with judge/scribe/ADR (default); `lean` = fast parallel review, see below |

**Output**

```json
{
  "content": [{
    "type": "text",
    "text": "{\"session_id\":\"...\",\"verdict\":\"APPROVED\",\"confidence\":\"High\",\"must_fix_items\":[],\"summary\":\"...\"}"
  }]
}
```

Verdict values: `APPROVED`, `APPROVE_WITH_CONDITIONS`, `REJECT`, `REVIEW_REQUIRED`

---

### Lean Mode (`review_mode: "lean"`)

Lean mode runs a fast parallel review optimised for early-stage feasibility checks. It skips `sf-judge`, `sf-scribe`, and ADR creation, returning a structured risk register in approximately 30 seconds.

**When to use lean vs full**

| | `full` | `lean` |
|---|---|---|
| Use case | Formal ARB review, gating decision | Early feasibility, quick risk triage |
| Agents | All activated specialists + judge + scribe | sf-designer + ≤4 domain specialists |
| Output | Verdict, ADR, must-fix items, dissent | Risk register, effort flags, domain signals |
| Time | 3–8 minutes | ~30 seconds |
| ADR created | Yes (in Jira after endorsement) | No |
| sf-learner | Yes (sequential) | Yes (fire-and-forget) |

**Lean output shape (`LeanReviewResponse`)**

```json
{
  "mode": "lean",
  "complexity_tier": "simple|moderate|complex|highly_complex",
  "risk_register": [
    {
      "id": "R-001",
      "title": "Governor limit risk on bulk triggers",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "domain": "sf-apex",
      "effort_impact": "Requires trigger handler refactor"
    }
  ],
  "effort_flags": ["External integration untested at volume"],
  "domain_signals": {
    "sf-apex": {
      "risk_level": "HIGH",
      "key_concerns": ["Bulkification gaps", "Missing async patterns"],
      "effort_impact": "Medium-high"
    }
  },
  "agents_activated": ["sf-designer", "sf-apex", "sf-integration"],
  "confidence": 0.85,
  "processing_time_ms": 18500
}
```

**Complexity tier derivation**

| Tier | Condition |
|---|---|
| `simple` | 0–1 specialists, no CRITICAL/HIGH |
| `moderate` | 2 specialists OR any HIGH |
| `complex` | 3 specialists OR any CRITICAL OR 3+ HIGH |
| `highly_complex` | 4 specialists OR 2+ CRITICAL OR cross-domain CRITICAL |

**Example lean request**

```json
{
  "method": "tools/call",
  "params": {
    "name": "review_document",
    "arguments": {
      "content": "...",
      "mode": "real",
      "review_mode": "lean"
    }
  }
}
```

**Example lean response**

```json
{
  "content": [{
    "type": "text",
    "text": "{\"mode\":\"lean\",\"complexity_tier\":\"complex\",\"risk_register\":[...],\"effort_flags\":[...],\"domain_signals\":{...},\"agents_activated\":[\"sf-designer\",\"sf-apex\",\"sf-integration\",\"sf-data\"],\"confidence\":0.82,\"processing_time_ms\":24100}"
  }]
}
```

---

### `get_session`

Retrieve results of a completed review session.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session ID returned by `review_document` |

**Output**

```json
{
  "content": [{
    "type": "text",
    "text": "{\"session_id\":\"...\",\"verdict\":\"APPROVED\",\"confidence\":\"High\",\"must_fix_items\":[],\"total_tokens\":12500,\"total_cost\":0.025,\"status\":\"completed\",\"created_at\":\"2026-07-15T...\"}"
  }]
}
```

---

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "arboard": {
      "url": "https://arboard.vercel.app/api/mcp",
      "headers": {
        "x-arboard-key": "YOUR_ARBOARD_API_KEY"
      }
    }
  }
}
```

## Claude Code Configuration

Add to your project's `.claude/settings.json` or run:

```bash
claude mcp add arboard --url https://arboard.vercel.app/api/mcp --header "x-arboard-key: YOUR_ARBOARD_API_KEY"
```

Or copy `mcp-config.json` from this repository and add your key.

---

## Example Usage

Once configured, Claude can review a design document directly:

> "Use ARBoard to review this design: [paste SDD text]"

Or in mock mode for testing:

> "Run an ARBoard mock review of the following document: [paste SDD text]"

To retrieve a prior session:

> "Get the ARBoard session results for session ID abc-123"

---

## Endpoint Reference

```
POST https://arboard.vercel.app/api/mcp
Headers:
  x-arboard-key: <key>
  Content-Type: application/json

# List tools
Body: { "method": "tools/list" }

# Call a tool
Body: {
  "method": "tools/call",
  "params": {
    "name": "review_document",
    "arguments": { "content": "...", "mode": "real" }
  }
}
```
