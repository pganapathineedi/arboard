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

    const { data: insertedRows, error } = await sb.from("org_learnings").insert(rows).select('id, content, domain, learning_type, context_key, context_value');
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

    // Fire-and-forget: embed each new org learning into grounding_embeddings
    void (async () => {
      if (!insertedRows?.length) return;
      for (const row of insertedRows) {
        try {
          const res = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ input: [row.content], model: 'voyage-code-3', input_type: 'document' }),
          });
          if (!res.ok) throw new Error(`Voyage API ${res.status}: ${await res.text()}`);
          const json = (await res.json()) as { data: { embedding: number[] }[] };
          const { error: upsertErr } = await sb.from('grounding_embeddings').upsert(
            {
              source_id: `org_learning_${row.id}`,
              content_type: 'org_learning',
              chunk_text: row.content,
              metadata: {
                domain: row.domain,
                learning_type: row.learning_type,
                context_key: row.context_key,
                context_value: row.context_value,
              },
              embedding: json.data[0].embedding,
            },
            { onConflict: 'source_id' },
          );
          if (upsertErr) throw new Error(upsertErr.message);
          console.log(`[org-learning] auto-embedded: ${row.id} — ${row.learning_type}`);
        } catch (embedErr) {
          console.error(`[org-learning] auto-embed failed for ${row.id}:`, embedErr instanceof Error ? embedErr.message : embedErr);
        }
      }
    })();
  } catch (err) {
    console.error("[learner-persist] parse/insert failed:", err instanceof Error ? err.message : err);
  }
}
