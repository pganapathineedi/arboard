import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase/client';
import { requireApiKey } from '@/lib/auth/requireApiKey';

export async function GET(req: NextRequest) {
  const authError = requireApiKey(req)
  if (authError) return authError
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalSessionsThisMonth },
      { data: costData },
      { data: roundData },
      { data: verdictData },
      { data: clientData },
      { data: weeklyData },
    ] = await Promise.all([
      supabase.from('sessions').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth),
      supabase.from('sessions').select('estimated_cost_usd').gte('created_at', startOfMonth),
      supabase.from('sessions').select('round_number').eq('status', 'completed'),
      supabase.from('sessions').select('verdict'),
      supabase.from('sessions').select('client_id'),
      supabase.from('sessions').select('created_at').gte('created_at', eightWeeksAgo).order('created_at', { ascending: true }),
    ]);

    const totalCostThisMonth = costData?.reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0) ?? 0;

    const avgRoundsToApproval = roundData?.length
      ? roundData.reduce((sum, r) => sum + (r.round_number ?? 1), 0) / roundData.length
      : 0;

    const verdictDistribution: Record<string, number> = {};
    for (const row of verdictData ?? []) {
      const v = row.verdict ?? 'UNKNOWN';
      verdictDistribution[v] = (verdictDistribution[v] ?? 0) + 1;
    }

    const clientCounts: Record<string, number> = {};
    for (const row of clientData ?? []) {
      const c = row.client_id ?? 'unknown';
      clientCounts[c] = (clientCounts[c] ?? 0) + 1;
    }
    const mostActiveClient = Object.entries(clientCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const sessionsByWeek: Record<string, number> = {};
    for (const row of weeklyData ?? []) {
      const weekStart = getWeekStart(new Date(row.created_at)).toISOString().split('T')[0];
      sessionsByWeek[weekStart] = (sessionsByWeek[weekStart] ?? 0) + 1;
    }

    return NextResponse.json({
      totalSessionsThisMonth: totalSessionsThisMonth ?? 0,
      totalCostThisMonth: Math.round(totalCostThisMonth * 1_000_000) / 1_000_000,
      avgRoundsToApproval: Math.round(avgRoundsToApproval * 100) / 100,
      verdictDistribution,
      mostActiveClient,
      sessionsByWeek,
    });
  } catch (err) {
    console.error('[admin/stats] query failed:', err);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}
