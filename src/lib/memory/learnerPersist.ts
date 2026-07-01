import { getSupabaseClient } from "@/lib/supabase/client";

interface LearningRow {
  session_id: string;
  domain: string;
  learning_type: "new_learning" | "confirmed_pattern" | "anti_pattern" | "org_context";
  content: string;
  context_key: string | null;
  context_value: string | null;
}

function parseSection(text: string, heading: string): string[] {
  const headingRe = new RegExp(`##\\s+${heading}[^\\n]*\\n`, "i");
  const match = headingRe.exec(text);
  if (!match) return [];
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextSection = rest.search(/^##\s/m);
  const block = nextSection === -1 ? rest : rest.slice(0, nextSection);
  return block
    .split("\n")
    .map(l => l.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(l => l && !/^[|#\-\s]*$/.test(l) && !l.startsWith("|"));
}

function parseOrgContext(text: string): { key: string; value: string }[] {
  const headingRe = /##\s+Suggested Org Context Updates[^\n]*\n/i;
  const match = headingRe.exec(text);
  if (!match) return [];
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextSection = rest.search(/^##\s/m);
  const block = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const results: { key: string; value: string }[] = [];
  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) results.push({ key, value });
  }
  return results;
}

export async function persistLearnerOutput(
  sessionId: string,
  domain: string,
  learnerOutputText: string,
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) {
    console.warn("[learner-persist] Supabase unavailable — skipping persistence");
    return;
  }

  try {
    const rows: LearningRow[] = [];

    for (const content of parseSection(learnerOutputText, "New Learnings from This Session")) {
      rows.push({ session_id: sessionId, domain, learning_type: "new_learning", content, context_key: null, context_value: null });
    }
    for (const content of parseSection(learnerOutputText, "Patterns Confirmed")) {
      rows.push({ session_id: sessionId, domain, learning_type: "confirmed_pattern", content, context_key: null, context_value: null });
    }
    for (const content of parseSection(learnerOutputText, "Anti-Patterns Detected")) {
      rows.push({ session_id: sessionId, domain, learning_type: "anti_pattern", content, context_key: null, context_value: null });
    }
    for (const { key, value } of parseOrgContext(learnerOutputText)) {
      rows.push({ session_id: sessionId, domain, learning_type: "org_context", content: `${key}: ${value}`, context_key: key, context_value: value });
    }

    if (rows.length === 0) {
      console.log(`[learner-persist] no parseable rows for session ${sessionId} — skipping insert`);
      return;
    }

    const { error } = await sb.from("org_learnings").insert(rows);
    if (error) {
      console.error("[learner-persist] insert error:", error.message);
      return;
    }

    const counts = {
      new: rows.filter(r => r.learning_type === "new_learning").length,
      confirmed: rows.filter(r => r.learning_type === "confirmed_pattern").length,
      anti: rows.filter(r => r.learning_type === "anti_pattern").length,
      ctx: rows.filter(r => r.learning_type === "org_context").length,
    };
    console.log(
      `[learner-persist] saved ${rows.length} learnings (${counts.new} new, ${counts.confirmed} confirmed, ${counts.anti} anti-patterns, ${counts.ctx} context updates) for session ${sessionId}`,
    );
  } catch (err) {
    console.error("[learner-persist] parse/insert failed:", err instanceof Error ? err.message : err);
  }
}
