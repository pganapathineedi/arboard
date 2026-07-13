import { createClient } from '@supabase/supabase-js';

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function embedText(text: string): Promise<number[]> {
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

  const { data: rows, error } = await supabase.from('org_learnings').select('*');

  if (error) throw new Error(`Failed to fetch org_learnings: ${error.message}`);
  if (!rows || rows.length === 0) {
    console.log('No org_learnings rows found.');
    return;
  }

  console.log(`Found ${rows.length} org_learnings rows to embed.`);

  let seeded = 0;
  for (const row of rows) {
    const embedding = await embedText(row.content);

    const { error: upsertErr } = await supabase.from('grounding_embeddings').upsert(
      {
        source_id: `org_learning_${row.id}`,
        content_type: 'org_learning',
        chunk_text: row.content,
        metadata: {
          domain: row.domain,
          learning_type: row.learning_type,
          context_key: row.context_key,
          context_value: row.context_value,
          session_id: row.session_id,
        },
        embedding,
      },
      { onConflict: 'source_id' }
    );

    if (upsertErr) {
      console.error(`  Failed to upsert org_learning_${row.id}: ${upsertErr.message}`);
    } else {
      console.log(`[org-learning] embedded: ${row.id} — ${row.learning_type}`);
      seeded++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(`Embedded ${seeded}/${rows.length} org_learnings successfully.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
