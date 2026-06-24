import { getSupabaseClient } from "@/lib/supabase/client";

export interface FailurePattern {
  id: string;
  title: string;
  severity: string;
  components: string[];
  scenario: string;
  better_path: string;
  source: string;
}

const AGENT_COMPONENTS: Record<string, string[]> = {
  "sf-apex":        ["Apex"],
  "sf-flow":        ["Flow"],
  "sf-integration": ["Integration"],
  "sf-data":        ["Data"],
  "sf-omniStudio":  ["OmniStudio"],
  "sf-designer":    ["Integration", "Apex", "Flow"],
  "sf-patterns":    ["Apex", "Flow", "Integration", "Data"],
  "sf-judge":       ["Apex", "Flow", "Integration", "Data", "OmniStudio"],
  "sf-lwc":         [],
};

const SEVERITY_ORDER = ["high", "medium", "low"];

export async function getRelevantPatterns(agentId: string): Promise<FailurePattern[]> {
  try {
    const components = AGENT_COMPONENTS[agentId];
    if (!components || components.length === 0) return [];

    const sb = getSupabaseClient();
    if (!sb) return [];

    const limit = agentId === "sf-judge" ? 5 : 3;

    const { data, error } = await sb
      .from("failure_patterns")
      .select("id, title, severity, components, scenario, better_path, source");

    if (error || !data) {
      console.warn("[patternRetrieval] query failed:", error?.message);
      return [];
    }

    const matched = (data as FailurePattern[]).filter(p =>
      Array.isArray(p.components) && p.components.some(c => components.includes(c))
    );

    matched.sort((a, b) => {
      const ai = SEVERITY_ORDER.indexOf(a.severity);
      const bi = SEVERITY_ORDER.indexOf(b.severity);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    return matched.slice(0, limit);
  } catch (err) {
    console.warn("[patternRetrieval] unexpected error:", err);
    return [];
  }
}

export function formatPatternBlock(patterns: FailurePattern[]): string {
  if (patterns.length === 0) return "";

  const lines: string[] = [
    "---",
    "RELEVANT SI FAILURE PATTERNS:",
  ];

  for (const p of patterns) {
    lines.push("");
    lines.push(`[${p.id}] ${p.title} (Severity: ${p.severity})`);
    lines.push(`Scenario: ${p.scenario}`);
    lines.push(`Better path: ${p.better_path}`);
  }

  lines.push("");
  lines.push(
    "IMPORTANT: You MUST reference any relevant patterns explicitly using their exact ID (e.g. FP-004, FP-007) in your analysis output. Do not paraphrase the ID. Write it exactly as shown: FP-004, FP-005, FP-006, or FP-007."
  );
  lines.push("---");

  return lines.join("\n");
}
