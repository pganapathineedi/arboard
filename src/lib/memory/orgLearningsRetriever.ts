import { getSupabaseClient } from '@/lib/supabase/client';

export async function retrieveOrgLearnings(domain: string): Promise<Record<string, unknown>[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn('[orgLearningsRetriever] Supabase client unavailable — returning empty learnings');
    return [];
  }

  const { data, error } = await client
    .from('org_learnings')
    .select('*')
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('[orgLearningsRetriever] Query failed:', error.message);
    return [];
  }

  return data ?? [];
}
