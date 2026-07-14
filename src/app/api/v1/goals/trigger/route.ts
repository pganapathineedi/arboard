import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/requireApiKey'
import { GoalOrchestrator } from '@/lib/goals/GoalOrchestrator'
import { getSupabaseClient } from '@/lib/supabase/client'

export const runtime = 'nodejs'
// Keep the Vercel function alive long enough for the background pipeline (~2-3 min)
export const maxDuration = 300

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(req)
  if (authError) return authError

  let body: { issueKey?: string; triggeredBy?: 'manual' | 'scheduled' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { issueKey, triggeredBy } = body
  if (!issueKey || issueKey.trim().length === 0) {
    return NextResponse.json({ error: 'issueKey is required' }, { status: 400 })
  }

  // Duplicate guard — one active goal per ticket at any time
  const sb = getSupabaseClient()
  if (sb) {
    const { data: activeGoal } = await sb
      .from('goals')
      .select('id')
      .eq('jira_issue_key', issueKey.trim())
      .in('status', ['pending', 'in_progress'])
      .maybeSingle()

    if (activeGoal) {
      return NextResponse.json(
        { error: 'Goal already active for this ticket' },
        { status: 409 },
      )
    }
  }

  const orchestrator = new GoalOrchestrator()
  const source = triggeredBy ?? 'manual'

  // Create the Supabase goal row synchronously — gives us the real UUID immediately
  let goalId: string
  try {
    const created = await orchestrator.createGoal(issueKey.trim(), source)
    goalId = created.goalId
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create goal' },
      { status: 500 },
    )
  }

  // Fire the full pipeline in the background without awaiting
  void orchestrator.executeGoal(goalId).catch(err => {
    console.error('[goals/trigger] background pipeline error:', err)
  })

  return NextResponse.json(
    { goalId, issueKey: issueKey.trim(), status: 'initiated' },
    { status: 202 },
  )
}
