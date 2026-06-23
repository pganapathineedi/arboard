import { NextResponse } from 'next/server';
import { createADRIssue } from '@/lib/integrations/jira';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  console.log('[jira/test] GET called');

  let result;
  try {
    result = await createADRIssue({
      requirement: 'Test connection from ARBoard Jira integration — dummy ADR requirement for verification',
      verdict: 'APPROVED WITH CONDITIONS',
      scribeNotes:
        'This is a test issue created by the ARBoard /api/jira/test endpoint to verify that ' +
        'Jira connectivity, authentication, and ADF formatting are all working correctly.',
      mustFixIssues: [
        'Confirm JIRA_DOMAIN resolves to your Atlassian Cloud instance',
        'Confirm JIRA_PROJECT_KEY matches an existing project in your workspace',
      ],
      sessionId: 'test-' + Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error('[jira/test] createADRIssue threw:', message);
    return NextResponse.json(
      { ok: false, error: isTimeout ? 'Request timed out after 10s' : message },
      { status: 502 },
    );
  }

  if (result === null) {
    return NextResponse.json(
      { ok: false, error: 'Jira env vars not configured — check JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY in .env.local' },
      { status: 500 },
    );
  }

  console.log('[jira/test] success', result);
  return NextResponse.json({ ok: true, issueKey: result.issueKey, issueUrl: result.issueUrl });
}
