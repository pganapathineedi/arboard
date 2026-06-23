import { NextResponse } from 'next/server';
import { countersignADR } from '@/lib/adr/store';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { sessionId, jiraIssueKey, architectName, architectRole, timestamp } = body as {
    sessionId?: string;
    jiraIssueKey?: string | null;
    architectName?: string;
    architectRole?: string;
    timestamp?: string;
  };

  if (!architectName?.trim() || !architectRole?.trim()) {
    return NextResponse.json({ ok: false, error: 'architectName and architectRole are required' }, { status: 400 });
  }

  const ts = timestamp ?? new Date().toISOString();

  try {
    await countersignADR({
      sessionId: sessionId ?? 'unknown',
      jiraIssueKey: jiraIssueKey ?? null,
      architectName: architectName.trim(),
      architectRole: architectRole.trim(),
      timestamp: ts,
    });
    return NextResponse.json({ ok: true, timestamp: ts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/adr/countersign] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
