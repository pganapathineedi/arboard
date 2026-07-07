import { NextRequest, NextResponse } from 'next/server'
import { ForumOrchestrator } from '@/lib/orchestrator/ForumOrchestrator'
import { validateExternalApiKey } from '@/lib/auth/externalApiAuth'
import type { ForumRequest } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

interface AgentFinding {
  agentId: string
  agentName: string
  content: string
  durationMs: number
  inputTokens: number
  outputTokens: number
}

interface ReviewResponse {
  session_id: string
  verdict: string
  findings: AgentFinding[]
  cost_usd: number
  total_tokens: number
  duration_ms: number
  client_id: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Validate external API key
  const auth = await validateExternalApiKey(req)
  if ('error' in auth) return auth.error

  let body: Partial<ForumRequest> & { document?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Accept either 'document' or 'input' field
  const input = body.document ?? body.input
  if (!input || input.trim().length === 0) {
    return NextResponse.json(
      { error: 'document field is required' },
      { status: 400 }
    )
  }

  const forumRequest: ForumRequest = {
    ...(body as ForumRequest),
    input,
    clientContext: {
      ...(body.clientContext ?? {}),
      metadata: {
        ...(body.clientContext?.metadata ?? {}),
        clientId: auth.record.client_id,
      },
    },
  }

  // Collect all SSE chunks into structured response
  const startTime = Date.now()
  const agentOutputs: Record<string, string> = {}
  const agentMeta: Record<string, { name: string; durationMs: number; inputTokens: number; outputTokens: number }> = {}
  let sessionId = ''
  let judgeContent = ''
  let totalInputTokens = 0
  let totalOutputTokens = 0

  try {
    for await (const chunk of ForumOrchestrator.streamForum(forumRequest, 'real')) {
      // Parse SSE line: "data: {...}"
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))

          switch (event.type) {
            case 'session_start':
              sessionId = event.sessionId
              break
            case 'token':
              agentOutputs[event.agentId] = (agentOutputs[event.agentId] ?? '') + event.token
              break
            case 'agent_complete':
              agentMeta[event.agentId] = {
                name: event.agentId,
                durationMs: event.durationMs ?? 0,
                inputTokens: event.inputTokens ?? 0,
                outputTokens: event.outputTokens ?? 0,
              }
              totalInputTokens += event.inputTokens ?? 0
              totalOutputTokens += event.outputTokens ?? 0
              break
            case 'agent_start':
              agentMeta[event.agentId] = {
                name: event.agentName ?? event.agentId,
                durationMs: 0,
                inputTokens: 0,
                outputTokens: 0,
              }
              break
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Review failed' },
      { status: 500 }
    )
  }

  // Extract judge content and verdict
  judgeContent = agentOutputs['sf-judge'] ?? ''
  const verdict = parseVerdict(judgeContent)

  // Build findings array (exclude scribe + learner from external response)
  const INTERNAL_AGENTS = new Set(['sf-scribe', 'sf-learner'])
  const findings: AgentFinding[] = Object.entries(agentOutputs)
    .filter(([id]) => !INTERNAL_AGENTS.has(id))
    .map(([agentId, content]) => ({
      agentId,
      agentName: agentMeta[agentId]?.name ?? agentId,
      content,
      durationMs: agentMeta[agentId]?.durationMs ?? 0,
      inputTokens: agentMeta[agentId]?.inputTokens ?? 0,
      outputTokens: agentMeta[agentId]?.outputTokens ?? 0,
    }))

  // Estimate cost (Sonnet rates)
  const cost_usd =
    (totalInputTokens * 3.0 + totalOutputTokens * 15.0) / 1_000_000

  const response: ReviewResponse = {
    session_id: sessionId,
    verdict,
    findings,
    cost_usd: Math.round(cost_usd * 10000) / 10000,
    total_tokens: totalInputTokens + totalOutputTokens,
    duration_ms: Date.now() - startTime,
    client_id: auth.record.client_id,
  }

  return NextResponse.json(response)
}

function parseVerdict(content: string): string {
  const u = content.toUpperCase()
  if (u.includes('APPROVE WITH CONDITIONS') || u.includes('APPROVED WITH CONDITIONS'))
    return 'APPROVE_WITH_CONDITIONS'
  if (u.includes('REJECT')) return 'REJECT'
  if (u.includes('APPROVE')) return 'APPROVE'
  return 'REVIEW_REQUIRED'
}
