import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/requireApiKey'
import { ForumOrchestrator } from '@/lib/orchestrator/ForumOrchestrator'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { ForumRequest } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const TOOL_DEFINITIONS = {
  tools: [
    {
      name: 'review_document',
      description:
        'Submit a Salesforce solution design document to ARBoard for multi-agent architecture review. Returns a full verdict with must-fix items, confidence level, and specialist agent findings.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The full text content of the solution design document',
          },
          requirement: {
            type: 'string',
            description: 'Optional: specific requirement or focus area for the review',
          },
          mode: {
            type: 'string',
            enum: ['real', 'mock'],
            description: 'real = live Claude agents, mock = fast test mode',
            default: 'real',
          },
          review_mode: {
            type: 'string',
            enum: ['full', 'lean'],
            description: 'full = complete multi-agent deliberation with judge/scribe/ADR (default); lean = fast parallel review without judge/scribe, returns structured risk register in ~30s',
            default: 'full',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'get_session',
      description:
        'Retrieve the full results of a completed ARBoard review session including verdict, agent findings, and must-fix items.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'The session ID returned by review_document',
          },
        },
        required: ['session_id'],
      },
    },
  ],
}

type McpBody = {
  method: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(req)
  if (authError) return authError

  let body: McpBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.method === 'tools/list') {
    return NextResponse.json(TOOL_DEFINITIONS)
  }

  if (body.method === 'tools/call') {
    const toolName = body.params?.name
    const args = (body.params?.arguments ?? {}) as Record<string, unknown>

    if (toolName === 'review_document') {
      return await callReviewDocument(args)
    }

    if (toolName === 'get_session') {
      return await callGetSession(args)
    }

    return NextResponse.json({ error: `Unknown tool: ${toolName}` }, { status: 400 })
  }

  return NextResponse.json({ error: `Unknown method: ${body.method}` }, { status: 400 })
}

async function callReviewDocument(args: Record<string, unknown>): Promise<NextResponse> {
  const content = args.content as string | undefined
  if (!content || content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const mode = (args.mode as 'real' | 'mock' | undefined) ?? 'real'
  const reviewMode = (args.review_mode as 'full' | 'lean' | undefined) ?? 'full'

  if (reviewMode === 'lean') {
    return callReviewDocumentLean(content, mode)
  }

  const forumRequest: ForumRequest = {
    input: content,
    ...(args.requirement
      ? {
          clientContext: {
            metadata: { requirement: args.requirement as string },
          },
        }
      : {}),
  }

  const agentOutputs: Record<string, string> = {}
  let sessionId = ''
  let verdict = ''
  let confidenceLevel = ''
  let mustFixItems: string[] = []

  try {
    for await (const chunk of ForumOrchestrator.streamForum(forumRequest, mode)) {
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
            case 'pending_endorsement':
              verdict = event.verdict ?? ''
              confidenceLevel = event.confidenceLevel ?? ''
              mustFixItems = Array.isArray(event.mustFixIssues) ? event.mustFixIssues : []
              break
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Review failed' },
      { status: 500 }
    )
  }

  const judgeContent = agentOutputs['sf-judge'] ?? ''
  const summary = judgeContent.slice(0, 500).trim()

  return NextResponse.json({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          session_id: sessionId,
          verdict,
          confidence: confidenceLevel,
          must_fix_items: mustFixItems,
          summary,
        }),
      },
    ],
  })
}

async function callReviewDocumentLean(
  content: string,
  mode: 'real' | 'mock',
): Promise<NextResponse> {
  let leanResult: Record<string, unknown> | null = null

  try {
    for await (const chunk of ForumOrchestrator.streamLeanForum(content, mode)) {
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>
          if (event.type === 'lean_result') {
            leanResult = event.result as Record<string, unknown>
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lean review failed' },
      { status: 500 },
    )
  }

  if (!leanResult) {
    return NextResponse.json({ error: 'No lean result produced' }, { status: 500 })
  }

  return NextResponse.json({
    content: [{ type: 'text', text: JSON.stringify(leanResult) }],
  })
}

async function callGetSession(args: Record<string, unknown>): Promise<NextResponse> {
  const sessionId = args.session_id as string | undefined
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  const [sessionResult, adrResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, verdict, confidence_level, total_tokens, estimated_cost_usd, status, created_at')
      .eq('id', sessionId)
      .single(),
    supabase
      .from('adrs')
      .select('must_fix_issues')
      .eq('session_id', sessionId)
      .limit(1)
      .maybeSingle(),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const session = sessionResult.data
  const mustFixItems: string[] = adrResult.data?.must_fix_issues ?? []

  return NextResponse.json({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          session_id: session.id,
          verdict: session.verdict ?? '',
          confidence: session.confidence_level ?? '',
          must_fix_items: mustFixItems,
          total_tokens: session.total_tokens ?? 0,
          total_cost: session.estimated_cost_usd ?? 0,
          status: session.status ?? '',
          created_at: session.created_at ?? '',
        }),
      },
    ],
  })
}
