import { getSupabaseClient } from '@/lib/supabase/client';

export interface JiraIssueParams {
  requirement: string;
  verdict: string;
  scribeNotes: string;
  mustFixIssues: string[];
  sessionId: string;
  projectKey?: string;
  confidenceLevel?: string;
  humanJudgementPoints?: string[];
  assigneeAccountId?: string;
  endorsementType?: 'countersigned' | 'assigned_for_review';
  revisionRound?: number;
}

export interface JiraMember {
  accountId:    string;
  displayName:  string;
  emailAddress: string;
}

export interface JiraEnv {
  domain: string;
  email:  string;
  token:  string;
}

export function getJiraEnv(): JiraEnv | null {
  const domain = process.env.JIRA_DOMAIN;
  const email  = process.env.JIRA_EMAIL;
  const token  = process.env.JIRA_API_TOKEN;
  if (!domain || !email || !token) return null;
  return { domain, email, token };
}

// Recursively extract plain text from an ADF document node
function extractADFText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    return (n.content as unknown[]).map(extractADFText).filter(Boolean).join(' ');
  }
  return '';
}

export async function fetchTicket(ticketId: string): Promise<string | null> {
  const domain = process.env.JIRA_DOMAIN;
  const email  = process.env.JIRA_EMAIL;
  const token  = process.env.JIRA_API_TOKEN;

  if (!domain || !email || !token) return null;

  try {
    const res = await fetch(
      `https://${domain}/rest/api/3/issue/${ticketId}?fields=summary,description`,
      { headers: buildJiraHeaders(email, token) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      fields: { summary: string; description: unknown };
    };
    const summary     = data.fields.summary ?? '';
    const description = extractADFText(data.fields.description);
    return [summary, description].filter(Boolean).join('\n\n');
  } catch {
    return null;
  }
}

export async function fetchProjectMembers(): Promise<JiraMember[]> {
  const domain     = process.env.JIRA_DOMAIN;
  const email      = process.env.JIRA_EMAIL;
  const token      = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!domain || !email || !token || !projectKey) return [];

  try {
    const url = `https://${domain}/rest/api/3/user/assignable/search?project=${projectKey}&maxResults=50`;
    const res = await fetch(url, { headers: buildJiraHeaders(email, token) });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ accountId?: string; displayName?: string; emailAddress?: string }>;
    return data
      .filter(u => u.accountId && u.displayName)
      .map(u => ({
        accountId:    u.accountId!,
        displayName:  u.displayName!,
        emailAddress: u.emailAddress ?? '',
      }));
  } catch {
    return [];
  }
}

export interface JiraResult {
  issueKey: string;
  issueUrl: string;
}

function verdictToLabel(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v.includes('condition')) return 'arboard-conditions';
  if (v.includes('revision')) return 'arboard-revision';
  if (v.includes('approv')) return 'arboard-approved';
  return 'arboard-review';
}

function verdictToPriority(verdict: string): 'High' | 'Medium' {
  const v = verdict.toLowerCase();
  return v.includes('condition') || v.includes('revision') ? 'High' : 'Medium';
}

function confidenceToPanelType(level: string): 'success' | 'note' | 'warning' {
  const l = level.toLowerCase();
  if (l.includes('high')) return 'success';
  if (l.includes('medium')) return 'note';
  return 'warning';
}

function buildADF(params: JiraIssueParams): object {
  const { requirement, verdict, scribeNotes, mustFixIssues, sessionId, confidenceLevel, humanJudgementPoints } = params;

  const content: object[] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Draft Recommendation' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: verdict || 'No recommendation recorded.' }],
    },
  ];

  if (confidenceLevel) {
    content.push({
      type: 'panel',
      attrs: { panelType: confidenceToPanelType(confidenceLevel) },
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `Confidence Level: ${confidenceLevel}`,
          marks: [{ type: 'strong' }],
        }],
      }],
    });
  }

  content.push(
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Rationale & Scribe Notes' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: scribeNotes || 'No scribe notes provided.' }],
    },
  );

  if (mustFixIssues.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Must-Fix Conditions' }],
    });
    content.push({
      type: 'bulletList',
      content: mustFixIssues.map(issue => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: issue }],
          },
        ],
      })),
    });
  }

  if (humanJudgementPoints && humanJudgementPoints.length > 0) {
    content.push(
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Points Requiring Human Judgement' }],
      },
      {
        type: 'bulletList',
        content: humanJudgementPoints.map(point => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: point }] }],
        })),
      },
    );
  }

  content.push(
    {
      type: 'panel',
      attrs: { panelType: 'note' },
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Awaiting countersignature by a human architect before this recommendation is finalised.',
        }],
      }],
    },
    { type: 'rule' },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Requirement: ${requirement}`,
          marks: [{ type: 'strong' }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Generated by ARBoard · Session ID: ${sessionId}`,
          marks: [{ type: 'em' }],
        },
      ],
    },
  );

  return { version: 1, type: 'doc', content };
}

export function buildJiraHeaders(email: string, token: string, forDownload = false): Record<string, string> {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  if (forDownload) {
    return { Authorization: `Basic ${auth}` };
  }
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function formatRevisionDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function verdictToResolutionStatus(verdict: string): 'Resolved' | 'Persists' | 'Escalated' {
  const v = verdict.toLowerCase();
  if (v.includes('escalat')) return 'Escalated';
  if (v.includes('approv') && !v.includes('condition')) return 'Resolved';
  return 'Persists';
}

async function searchExistingTicket(
  requirement: string,
  projectKey: string,
  domain: string,
  email: string,
  token: string,
): Promise<string | null> {
  const summaryPrefix = `[ARBoard ADR] ${requirement.slice(0, 60)}`;
  const escaped = summaryPrefix.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const jql = encodeURIComponent(`project = "${projectKey}" AND summary ~ "${escaped}" AND labels = "arboard-adr" ORDER BY created DESC`);
  try {
    const res = await fetch(
      `https://${domain}/rest/api/3/search?jql=${jql}&maxResults=1&fields=summary,labels`,
      { headers: buildJiraHeaders(email, token) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { issues: Array<{ key: string }> };
    return data.issues?.[0]?.key ?? null;
  } catch {
    return null;
  }
}

async function appendRevisionComment(
  issueKey: string,
  revisionRound: number,
  verdict: string,
  scribeNotes: string,
  domain: string,
  email: string,
  token: string,
): Promise<void> {
  const date = formatRevisionDate(new Date());
  const resolutionStatus = verdictToResolutionStatus(verdict);

  const commentText = [
    `--- Revision ${revisionRound} Review (${date}) ---`,
    `Verdict: ${verdict}`,
    `Resolution status: ${resolutionStatus}`,
    `Agent notes: ${scribeNotes.slice(0, 500)}`,
  ].join('\n');

  await fetch(`https://${domain}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: buildJiraHeaders(email, token),
    body: JSON.stringify({
      body: {
        version: 1, type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
      },
    }),
  }).catch(err => { console.warn('[jira] revision comment POST failed:', err); });

  // Update labels to reflect resolution
  const getRes = await fetch(`https://${domain}/rest/api/3/issue/${issueKey}`, {
    headers: buildJiraHeaders(email, token),
  }).catch(() => null);

  if (getRes?.ok) {
    const issueData = (await getRes.json()) as { fields: { labels: string[] } };
    let updated = (issueData.fields.labels ?? []).filter(
      l => l !== 'arboard-revision' && l !== 'arboard-conditions',
    );
    if (resolutionStatus === 'Resolved') {
      updated = updated.filter(l => l !== 'arboard-approved').concat('arboard-approved', 'arboard-resolved');
    }
    await fetch(`https://${domain}/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      headers: buildJiraHeaders(email, token),
      body: JSON.stringify({ fields: { labels: updated } }),
    }).catch(err => { console.warn('[jira] label update after revision failed:', err); });
  }
}

export async function createADRIssue(params: JiraIssueParams): Promise<JiraResult | null> {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = params.projectKey ?? process.env.JIRA_PROJECT_KEY;

  console.log('[jira] createADRIssue called', {
    domain: domain ?? '(not set)',
    email: email ? email.slice(0, 4) + '…' : '(not set)',
    tokenSet: !!token,
    projectKey: projectKey ?? '(not set)',
    sessionId: params.sessionId,
  });

  if (!domain || !email || !token || !projectKey) {
    console.warn('[jira] env vars not fully configured — skipping Jira write');
    return null;
  }

  // On revision runs, check for an existing ticket before creating a duplicate
  if (params.revisionRound && params.revisionRound >= 1) {
    const existingKey = await searchExistingTicket(params.requirement, projectKey, domain, email, token);
    if (existingKey) {
      console.log('[jira] existing ticket found — appending revision comment', { existingKey, revisionRound: params.revisionRound });
      await appendRevisionComment(
        existingKey,
        params.revisionRound,
        params.verdict,
        params.scribeNotes,
        domain,
        email,
        token,
      );
      return { issueKey: existingKey, issueUrl: `https://${domain}/browse/${existingKey}` };
    }
    console.log('[jira] no existing ticket found for revision run — creating new ticket');
  }

  const url = `https://${domain}/rest/api/3/issue`;
  const summary = `[ARBoard ADR] ${params.requirement.slice(0, 80)}`.replace(/[\r\n]+/g, ' ').trim();
  const verdictLabel = verdictToLabel(params.verdict);

  const labels = ['arboard-adr', verdictLabel];
  if (params.endorsementType === 'countersigned') labels.push('arboard-signed');

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    issuetype: { name: 'Task' },
    priority: { name: verdictToPriority(params.verdict) },
    labels,
    description: buildADF(params),
  };
  if (params.assigneeAccountId) fields.assignee = { accountId: params.assigneeAccountId };

  const body = { fields };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error('[jira] fetch timed out after 10s — aborting');
    controller.abort();
  }, 10_000);

  try {
    console.log('[jira] sending POST to', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: buildJiraHeaders(email, token),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    console.log('[jira] Jira API responded', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { key: string };
    console.log('[jira] issue created successfully', { issueKey: data.key });

    if (params.humanJudgementPoints && params.humanJudgementPoints.length > 0) {
      const commentLines = [
        'Points Requiring Human Judgement',
        '',
        ...params.humanJudgementPoints.map(p => `- ${p}`),
      ].join('\n');
      const commentBody = {
        body: {
          version: 1, type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: commentLines }],
          }],
        },
      };
      await fetch(`https://${domain}/rest/api/3/issue/${data.key}/comment`, {
        method: 'POST',
        headers: buildJiraHeaders(email, token),
        body: JSON.stringify(commentBody),
      }).catch(err => { console.warn('[jira] human judgement comment failed:', err); });
    }

    // Fire-and-forget: embed the new ADR into grounding_embeddings
    void (async () => {
      try {
        const descriptionPlainText = extractADFText(buildADF(params));
        const chunkText = `${summary}\n\n${descriptionPlainText}`.slice(0, 8000);
        const voyageRes = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ input: [chunkText], model: 'voyage-code-3', input_type: 'document' }),
        });
        if (!voyageRes.ok) throw new Error(`Voyage API ${voyageRes.status}: ${await voyageRes.text()}`);
        const voyageJson = (await voyageRes.json()) as { data: { embedding: number[] }[] };
        const sb = getSupabaseClient();
        if (!sb) throw new Error('Supabase client unavailable');
        const { error: upsertErr } = await sb.from('grounding_embeddings').upsert(
          {
            source_id: `jira_adr_${data.key}`,
            content_type: 'jira_adr',
            chunk_text: chunkText,
            metadata: { key: data.key, summary },
            embedding: voyageJson.data[0].embedding,
          },
          { onConflict: 'source_id' },
        );
        if (upsertErr) throw new Error(upsertErr.message);
        console.log(`[jira-adr] auto-embedded: ${data.key}`);
      } catch (embedErr) {
        console.error('[jira-adr] auto-embed failed:', embedErr instanceof Error ? embedErr.message : embedErr);
      }
    })();

    return { issueKey: data.key, issueUrl: `https://${domain}/browse/${data.key}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function updateADRSignOff(params: {
  issueKey: string;
  architectName: string;
  architectRole: string;
  timestamp: string;
}): Promise<void> {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!domain || !email || !token) {
    console.warn('[jira] env vars not configured — skipping Jira sign-off update');
    return;
  }

  const headers = buildJiraHeaders(email, token);
  const baseUrl = `https://${domain}/rest/api/3/issue/${params.issueKey}`;

  // Add countersignature as a comment
  const commentBody = {
    body: {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'success' },
          content: [{
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Countersigned by: ${params.architectName}, ${params.architectRole}`,
                marks: [{ type: 'strong' }],
              },
              { type: 'hardBreak' },
              {
                type: 'text',
                text: `Timestamp: ${params.timestamp}`,
                marks: [{ type: 'em' }],
              },
            ],
          }],
        },
      ],
    },
  };

  const commentRes = await fetch(`${baseUrl}/comment`, {
    method: 'POST',
    headers,
    body: JSON.stringify(commentBody),
  }).catch(err => { console.error('[jira] comment POST failed:', err); return null; });

  if (commentRes && !commentRes.ok) {
    console.warn('[jira] comment POST returned', commentRes.status);
  }

  // Update labels: GET current labels, add arboard-signed, remove arboard-adr
  const getRes = await fetch(baseUrl, { headers }).catch(() => null);
  if (getRes?.ok) {
    const issueData = (await getRes.json()) as { fields: { labels: string[] } };
    const currentLabels: string[] = issueData.fields.labels ?? [];
    const newLabels = currentLabels.filter(l => l !== 'arboard-adr').concat('arboard-signed');

    await fetch(baseUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ fields: { labels: newLabels } }),
    }).catch(err => { console.error('[jira] label update failed:', err); });
  }
}

export async function updateJiraLabels(
  issueKey: string,
  addLabel: string,
  removeLabels: string[],
  domain: string,
  email: string,
  token: string,
): Promise<void> {
  const headers = buildJiraHeaders(email, token);
  const baseUrl = `https://${domain}/rest/api/3/issue/${issueKey}`;
  const getRes = await fetch(baseUrl, { headers }).catch(() => null);
  if (!getRes?.ok) {
    console.warn(`[jira] failed to GET ${issueKey} for label update`);
    return;
  }
  const issueData = (await getRes.json()) as { fields: { labels: string[] } };
  const current: string[] = issueData.fields.labels ?? [];
  const updated = current.filter(l => !removeLabels.includes(l));
  if (!updated.includes(addLabel)) updated.push(addLabel);
  await fetch(baseUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ fields: { labels: updated } }),
  }).catch(err => { console.warn('[jira] label update PUT failed:', err); });
}

export async function postJiraComment(
  issueKey: string,
  text: string,
  domain: string,
  email: string,
  token: string,
): Promise<void> {
  await fetch(`https://${domain}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: buildJiraHeaders(email, token),
    body: JSON.stringify({
      body: {
        version: 1,
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  }).catch(err => { console.warn('[jira] comment POST failed:', err); });
}
