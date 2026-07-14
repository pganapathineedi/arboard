import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/requireApiKey'
import { GoalOrchestrator } from '@/lib/goals/GoalOrchestrator'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(req)
  if (authError) return authError

  try {
    const orchestrator = new GoalOrchestrator()
    const goals = await orchestrator.fetchPendingGoals()
    return NextResponse.json({ goals })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch pending goals' },
      { status: 500 },
    )
  }
}
