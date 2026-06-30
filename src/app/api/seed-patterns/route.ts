import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

const PATTERNS = [
  {
    id: "FP-004",
    title: "API limit breach during bulk integration — no governor limit analysis upfront",
    severity: "high",
    components: ["Integration", "Data"],
    scenario:
      "Integration design proceeded without upfront API limit analysis. Bulk data sync via REST API hit the daily API call limit on day 3 of UAT. The integration had to be redesigned to use Bulk API 2.0 and batching — delaying go-live by 3 weeks and requiring renegotiation of the project timeline.",
    better_path:
      "Before any integration design, calculate projected API call volumes against Salesforce limits. For high-volume data movement, default to Bulk API 2.0. Build error logging and retry mechanisms from day one.",
    source: "real",
  },
  {
    id: "FP-005",
    title: "Direct DB query via MuleSoft as CDC workaround — no error handling or retry",
    severity: "medium",
    components: ["Integration", "OmniStudio"],
    scenario:
      "Platform Events hit governor limits under large transaction volumes, so the team routed CDC through MuleSoft querying the database directly. The workaround was deployed without error logging or retry logic. When DB connections timed out under load, silent failures caused data sync gaps not detected until downstream reporting showed inconsistencies weeks later.",
    better_path:
      "Direct DB queries as a CDC workaround can be valid, but must include: connection pooling, retry with exponential backoff, dead-letter queue for failed events, and end-to-end reconciliation checks. Never deploy integration workarounds without monitoring.",
    source: "real",
  },
  {
    id: "FP-006",
    title: "No error logging designed in — failures invisible until production incident",
    severity: "high",
    components: ["Apex", "Flow", "Integration"],
    scenario:
      "Apex trigger and integration code deployed to production with no centralised error logging. When a trigger failed silently on a subset of records during a bulk load, the team had no visibility. The issue surfaced 2 weeks later via a client complaint about missing data — investigation required manual log trawling across 3 systems.",
    better_path:
      "Design error logging as a first-class requirement, not an afterthought. Use a Platform Event-based logging framework or custom object. Every trigger, flow, and integration must log failures with context from day one of development.",
    source: "generated",
  },
  {
    id: "FP-007",
    title: "SOQL query inside loop — governor limit hit during bulk trigger execution",
    severity: "high",
    components: ["Apex"],
    scenario:
      "Developer wrote a SOQL query inside a for-loop within an Apex trigger. Functioned correctly in dev org with small data sets. In production, a batch load of 200 records triggered the too many SOQL queries: 101 limit, causing the entire batch to fail and roll back — with no alerting until client reported missing records.",
    better_path:
      "Bulkify all Apex — collect record IDs, query once outside the loop, map results, then iterate. Enforce this via code review checklist. Use a trigger framework such as FFLIB that enforces bulkification patterns by design.",
    source: "generated",
  },
  {
    id: "FP-008",
    title: "MuleSoft heap size breach due to payload scope creep",
    severity: "medium",
    components: ["Integration"],
    scenario:
      "Integration payload was designed for initial scope, then expanded as business requirements grew without reassessing heap size constraints. Payloads exceeded MuleSoft heap limits under production load, causing integration failures. The original design had no allowance for future requirement growth.",
    better_path:
      "Split integrations into smaller modular elements. Even if initial design stays within limits, build in headroom for scope expansion. Reassess heap usage at every scope change.",
    source: "real",
  },
  {
    id: "FP-009",
    title: "Error logging without resolution path — log and hope",
    severity: "high",
    components: ["Apex", "Flow", "Integration"],
    scenario:
      "Designs that end at 'log the error' rather than 'log the error and ensure resolution'. Support teams were handed error logs with no runbook, no escalation path, and no context on how to resolve. Errors sat unresolved because the supporting team had no guidance.",
    better_path:
      "Error handling design must include: who owns resolution, what the remediation steps are, and how the supporting team is informed and trained. Consider all users of a piece of work — not just the happy-path users. Logging is not a resolution strategy.",
    source: "real",
  },
  {
    id: "FP-010",
    title: "Multiple automation tools per object — ad hoc trigger decisions",
    severity: "high",
    components: ["Apex", "Flow"],
    scenario:
      "Automations were added to objects based on what made sense for each individual change, resulting in a mix of Flows and Apex Triggers on the same object. Each design made ad hoc decisions on whether logic belonged in Flow or Apex, leading to unpredictable execution order, duplicated logic, and difficult troubleshooting.",
    better_path:
      "Establish one automation tool per object based on criticality and volume. Hot objects use Apex Triggers; non-hot objects default to Flow. Enforce this consistently across the delivery. Improves readability, maintainability, performance, and traceability.",
    source: "real",
  },
  {
    id: "FP-011",
    title: "Lightest-tool principle applied without system consistency — unusable UX",
    severity: "medium",
    components: ["Solution Design"],
    scenario:
      "Following best practice to use the lightest tool for each use case resulted in a system where different objects used different automation approaches, UI patterns, and interaction models. Users described the system as requiring 'a degree in the platform' to use. Consistency was sacrificed for micro-optimisation.",
    better_path:
      "Set UI and performance standards early. Choose technology that aligns to those standards consistently — sometimes that means using a heavier tool than strictly necessary for a given unit of work. Value system consistency over the smallest cost per workunit.",
    source: "real",
  },
  {
    id: "FP-012",
    title: "Heavy reliance on Page Layouts — performance and maintainability degradation",
    severity: "medium",
    components: ["LWC", "Solution Design"],
    scenario:
      "Team defaulted to creating separate Page Layouts and Lightning Record Pages per record type, even when dynamic rendering was required. Proliferation of LRPs and Page Layouts led to poor page performance, high maintenance overhead, and inconsistent user experience across the org.",
    better_path:
      "Leverage Lightning Record Pages with Dynamic Forms over legacy Page Layouts. Consolidate screen requirements into a minimal number of LRPs per object. Use Dynamic Forms to show/hide fields dynamically. Only create new LRPs when dynamic components exceed ~10. Reduces maintenance overhead and improves performance.",
    source: "real",
  },
];

export async function POST() {
  const sb = getSupabaseClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase unavailable" }, { status: 503 });
  }

  const { error } = await sb
    .from("failure_patterns")
    .upsert(PATTERNS, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ seeded: PATTERNS.length, ids: PATTERNS.map(p => p.id) });
}
