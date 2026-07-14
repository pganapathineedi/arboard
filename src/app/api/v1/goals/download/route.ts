import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/requireApiKey'
import { getSupabaseClient } from '@/lib/supabase/client'
import { buildJiraHeaders, getJiraEnv } from '@/lib/integrations/jira'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(req)
  if (authError) return authError

  const issueKey = req.nextUrl.searchParams.get('issueKey')
  if (!issueKey) {
    return NextResponse.json({ error: 'issueKey is required' }, { status: 400 })
  }

  const sb = getSupabaseClient()
  if (!sb) {
    return NextResponse.json({ error: 'Supabase client unavailable' }, { status: 500 })
  }

  const env = getJiraEnv()
  if (!env) {
    return NextResponse.json({ error: 'Jira environment variables not configured' }, { status: 500 })
  }

  // Look up the most recent goal row for this issue key (any status)
  const { data: row, error: dbErr } = await sb
    .from('goals')
    .select('attachment_url, attachment_name')
    .eq('jira_issue_key', issueKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (dbErr || !row) {
    return NextResponse.json(
      { error: dbErr?.message ?? `No goal found for ${issueKey}` },
      { status: 404 },
    )
  }

  const { attachment_url, attachment_name } = row as { attachment_url: string; attachment_name: string }

  try {
    // Download bytes from Jira server-side — credentials never reach the browser
    const dlRes = await fetch(attachment_url, {
      headers: buildJiraHeaders(env.email, env.token, true),
    })

    if (!dlRes.ok) {
      return NextResponse.json(
        { error: `Jira attachment download failed: HTTP ${dlRes.status}` },
        { status: 502 },
      )
    }

    const bytes = await dlRes.arrayBuffer()

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${attachment_name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Download failed' },
      { status: 500 },
    )
  }
}
