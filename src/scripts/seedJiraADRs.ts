import { createClient } from '@supabase/supabase-js';

const VOYAGE_API_KEY          = process.env.VOYAGE_API_KEY;
const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JIRA_DOMAIN              = process.env.JIRA_DOMAIN;
const JIRA_EMAIL               = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN           = process.env.JIRA_API_TOKEN;
const VOYAGE_DELAY_MS          = 100;

function buildJiraHeaders(): Record<string, string> {
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function extractADFText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    return (n.content as unknown[]).map(extractADFText).filter(Boolean).join(' ');
  }
  return '';
}

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
  if (!VOYAGE_API_KEY)           throw new Error('VOYAGE_API_KEY env var is required');
  if (!SUPABASE_URL)             throw new Error('SUPABASE_URL env var is required');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');
  if (!JIRA_DOMAIN)              throw new Error('JIRA_DOMAIN env var is required');
  if (!JIRA_EMAIL)               throw new Error('JIRA_EMAIL env var is required');
  if (!JIRA_API_TOKEN)           throw new Error('JIRA_API_TOKEN env var is required');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const jql = encodeURIComponent('project=ARBOARD ORDER BY created DESC');
  const url = `https://${JIRA_DOMAIN}/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,description`;

  const res = await fetch(url, { headers: buildJiraHeaders() });
  if (!res.ok) throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    issues: Array<{ key: string; fields: { summary: string; description: unknown } }>;
  };
  const issues = data.issues ?? [];
  console.log(`Found ${issues.length} issues in ARBOARD project.`);

  let seeded = 0;
  for (const issue of issues) {
    const summary = issue.fields.summary ?? '';

    if (/test connection/i.test(summary)) {
      console.log(`[jira-adr] skipped (test): ${issue.key}`);
      continue;
    }

    const descriptionText = extractADFText(issue.fields.description);
    const chunkText = `${summary}\n\n${descriptionText}`.slice(0, 8000);

    const embedding = await embedText(chunkText);

    const { error } = await supabase.from('grounding_embeddings').upsert(
      {
        source_id: `jira_adr_${issue.key}`,
        content_type: 'jira_adr',
        chunk_text: chunkText,
        metadata: { key: issue.key, summary },
        embedding,
      },
      { onConflict: 'source_id' },
    );

    if (error) {
      console.error(`  Failed to upsert ${issue.key}: ${error.message}`);
    } else {
      console.log(`[jira-adr] embedded: ${issue.key} — ${summary.slice(0, 60)}`);
      seeded++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(`Embedded ${seeded} Jira ADRs successfully.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
