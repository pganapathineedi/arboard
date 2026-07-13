/**
 * Generic per-agent seed script.
 * Embeds the agent's skill file and failure patterns into grounding_embeddings.
 *
 * Usage: npm run seed:agent -- <agent-id>
 * Example: npm run seed:agent -- sf-profiles-permissions
 *
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;
const MIN_CHUNK_LENGTH = 100;

interface ManifestEntry {
  id: string;
  name: string;
  file: string;
  domain?: string;
  [key: string]: unknown;
}

interface ManifestFile {
  agents: ManifestEntry[];
}

interface FailurePattern {
  id: string;
  title: string;
  scenario: string;
  better_path: string;
  source: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors chunkByH2 from src/scripts/seedEmbeddings.ts — splits on ## headings
function chunkByH2(text: string): string[] {
  return text
    .split(/(?=^## )/m)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CHUNK_LENGTH);
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-code-3", input_type: "document" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function main() {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error("Usage: npm run seed:agent -- <agent-id>");
    console.error("Example: npm run seed:agent -- sf-profiles-permissions");
    process.exit(1);
  }

  // Load manifest and find agent entry
  const manifestPath = path.join(process.cwd(), "src/config/agentManifest.json");
  const manifest: ManifestFile = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entry = manifest.agents.find((a) => a.id === agentId);
  if (!entry) {
    console.error(`Agent "${agentId}" not found in agentManifest.json`);
    console.error(`Available: ${manifest.agents.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${agentId}] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error(`[${agentId}] Missing VOYAGE_API_KEY`);
    process.exit(1);
  }

  const domain = entry.domain ?? "salesforce";

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // ── Step 1: Skill file ──────────────────────────────────────────────────────
  let skillChunkCount = 0;
  const skillPath = path.join(process.cwd(), `src/skills/domains/${entry.file}.md`);

  if (fs.existsSync(skillPath)) {
    const chunks = chunkByH2(fs.readFileSync(skillPath, "utf-8"));
    console.log(`[${agentId}] Skill file found — ${chunks.length} chunk(s)`);

    for (let i = 0; i < chunks.length; i++) {
      const sourceId = `${agentId}-${i}`;
      console.log(`  [skill] Embedding chunk ${i} (${sourceId})…`);
      const embedding = await embedText(chunks[i]);

      const { error } = await sb.from("grounding_embeddings").upsert(
        {
          source_id: sourceId,
          content_type: "skill",
          chunk_text: chunks[i],
          metadata: { domain, chunk_index: i, file: entry.file },
          embedding,
        },
        { onConflict: "source_id" }
      );

      if (error) {
        console.error(`  [skill] Failed ${sourceId}: ${error.message}`);
      } else {
        skillChunkCount++;
      }

      await delay(VOYAGE_DELAY_MS);
    }
  } else {
    console.log(`[${agentId}] No skill file at ${skillPath} — skipping`);
  }

  // ── Step 2: Failure patterns ────────────────────────────────────────────────
  let patternCount = 0;
  const { data: patterns, error: fetchError } = await sb
    .from("failure_patterns")
    .select("*")
    .eq("source", agentId);

  if (fetchError) {
    console.error(`[${agentId}] Failed to query failure_patterns: ${fetchError.message}`);
  } else if (!patterns || patterns.length === 0) {
    console.log(`[${agentId}] No failure patterns found for source="${agentId}" — skipping`);
  } else {
    console.log(`[${agentId}] Found ${patterns.length} failure pattern(s)`);

    for (const pattern of patterns as FailurePattern[]) {
      const combinedText = `${pattern.title}\n\n${pattern.scenario}\n\n${pattern.better_path}`;
      console.log(`  [failure_pattern] Embedding ${pattern.id}…`);
      const embedding = await embedText(combinedText);

      const { error } = await sb.from("grounding_embeddings").upsert(
        {
          source_id: pattern.id,
          content_type: "failure_pattern",
          chunk_text: combinedText,
          metadata: { domain },
          embedding,
        },
        { onConflict: "source_id" }
      );

      if (error) {
        console.error(`  [failure_pattern] Failed ${pattern.id}: ${error.message}`);
      } else {
        patternCount++;
      }

      await delay(VOYAGE_DELAY_MS);
    }
  }

  console.log(`\n${agentId} — ${skillChunkCount} skill chunks embedded, ${patternCount} failure patterns embedded`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
