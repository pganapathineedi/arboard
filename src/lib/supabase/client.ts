import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _initialized = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (_initialized) return _client;
  _initialized = true;

  const url = process.env.SUPABASE_URL;
  // Accept both the legacy service-role key and the newer sb_publishable_* / sb_secret_* formats.
  // SUPABASE_ANON_KEY is the conventional name for publishable keys in Next.js projects.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.log('[supabase] client NOT initialised — missing env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY)');
    return null;
  }

  // No key-format validation here — both legacy eyJ JWT keys and new sb_publishable_* /
  // sb_secret_* strings are accepted as-is and forwarded by the SDK as the apikey header.
  try {
    _client = createClient(url, key, {
      auth: {
        // Disable automatic session persistence; this is a server-side client.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    console.log(`[supabase] client initialised — url=${url} key=${key.substring(0, 12)}…`);
  } catch (err) {
    console.error('[supabase] createClient threw — Supabase will be unavailable:', err);
    return null;
  }

  return _client;
}
