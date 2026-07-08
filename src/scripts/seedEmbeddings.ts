import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FORCE = process.argv.includes('--force');
const MIN_CHUNK_LENGTH = 100;
const VOYAGE_DELAY_MS = 100;

interface Chunk {
  sourceId: string;
  chunkText: string;
  contentType: 'failure_pattern' | 'skill';
  metadata: { file: string; section: string; agent_hints: string[] };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function resolveSkillsRoot(): string {
  // Works whether CWD is project root or src/scripts
  const candidates = [
    path.resolve(process.cwd(), 'src', 'skills'),
    path.resolve(__dirname, '..', 'skills'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Cannot locate src/skills directory');
}

function globMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
}

function chunkFailurePatterns(text: string, filename: string): Chunk[] {
  // Split on ## FP- boundaries; keep the header with each chunk
  const parts = text.split(/(?=^## FP-)/m).filter((p) => p.trim().length >= MIN_CHUNK_LENGTH);
  return parts.map((part) => {
    const headerMatch = part.match(/^## (FP-\d+)/m);
    const fpId = headerMatch ? headerMatch[1] : 'unknown';
    return {
      sourceId: `failure-patterns/${fpId}`,
      chunkText: part.trim(),
      contentType: 'failure_pattern',
      metadata: { file: filename, section: fpId, agent_hints: [] },
    };
  });
}

function chunkByH2(text: string, filename: string, dirLabel: string): Chunk[] {
  // Split on ## boundaries; keep the header with each chunk
  const parts = text.split(/(?=^## )/m).filter((p) => p.trim().length >= MIN_CHUNK_LENGTH);
  const baseName = path.basename(filename, '.md');
  return parts.map((part) => {
    const headerMatch = part.match(/^## (.+)/m);
    const section = headerMatch ? headerMatch[1].trim() : 'intro';
    const sourceId = dirLabel ? `${dirLabel}/${baseName}/${section}` : `${baseName}/${section}`;
    return {
      sourceId,
      chunkText: part.trim(),
      contentType: 'skill',
      metadata: { file: filename, section, agent_hints: [] },
    };
  });
}

function collectChunks(skillsRoot: string): Chunk[] {
  const chunks: Chunk[] = [];

  // failure-patterns.md
  const fpFile = path.join(skillsRoot, 'failure-patterns.md');
  if (fs.existsSync(fpFile)) {
    chunks.push(...chunkFailurePatterns(fs.readFileSync(fpFile, 'utf-8'), 'failure-patterns.md'));
  }

  // well-architected-framework.md
  const wafFile = path.join(skillsRoot, 'well-architected-framework.md');
  if (fs.existsSync(wafFile)) {
    chunks.push(...chunkByH2(fs.readFileSync(wafFile, 'utf-8'), 'well-architected-framework.md', ''));
  }

  // cross-cutting/*.md
  for (const file of globMd(path.join(skillsRoot, 'cross-cutting'))) {
    chunks.push(...chunkByH2(fs.readFileSync(file, 'utf-8'), path.basename(file), 'cross-cutting'));
  }

  // domains/*.md
  for (const file of globMd(path.join(skillsRoot, 'domains'))) {
    chunks.push(...chunkByH2(fs.readFileSync(file, 'utf-8'), path.basename(file), 'domains'));
  }

  return chunks;
}

async function embedChunk(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [text], model: 'voyage-code-3', input_type: 'document' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function main() {
  if (!VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY env var is required');
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL env var is required');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Guard: abort if rows already exist and --force not supplied
  const { count, error: countErr } = await supabase
    .from('grounding_embeddings')
    .select('*', { count: 'exact', head: true });

  if (countErr) throw new Error(`Supabase count failed: ${countErr.message}`);

  if ((count ?? 0) > 0 && !FORCE) {
    console.error(
      `grounding_embeddings already has ${count} rows. Re-run with --force to overwrite.`
    );
    process.exit(1);
  }

  const skillsRoot = resolveSkillsRoot();
  const chunks = collectChunks(skillsRoot);
  console.log(`Found ${chunks.length} chunks to seed.`);

  let seeded = 0;
  for (const chunk of chunks) {
    console.log(`Seeding chunk: ${chunk.sourceId}`);

    const embedding = await embedChunk(chunk.chunkText);

    const { error } = await supabase.from('grounding_embeddings').upsert(
      {
        source_id: chunk.sourceId,
        content_type: chunk.contentType,
        chunk_text: chunk.chunkText,
        metadata: chunk.metadata,
        embedding,
      },
      { onConflict: 'source_id' }
    );

    if (error) {
      console.error(`  Failed to upsert ${chunk.sourceId}: ${error.message}`);
    } else {
      seeded++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(`Seeded ${seeded} chunks successfully`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
