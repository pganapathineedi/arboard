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
