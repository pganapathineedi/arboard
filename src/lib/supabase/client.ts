import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _initialized = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (_initialized) return _client;
  _initialized = true;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log('[supabase] client NOT initialised — missing env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    return null;
  }

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
