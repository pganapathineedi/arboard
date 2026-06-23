import { createClient } from '@supabase/supabase-js';
import { createADRIssue, updateADRSignOff } from '@/lib/integrations/jira';
import type { ClientConfig } from '@/lib/clients/types';

export interface SaveADRParams {
  requirement: string;
  verdict: string;
  scribeNotes: string;
  mustFixIssues: string[];
  sessionId: string;
  clientId?: string;
  confidenceLevel?: string;
  humanJudgementPoints?: string[];
}

export interface SavedADR {
  id: string;
  sessionId: string;
  requirement: string;
  verdict: string;
  scribeNotes: string;
  mustFixIssues: string[];
  createdAt: string;
  jiraIssueKey?: string;
  jiraIssueUrl?: string;
}

function tryGetSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function resolveJiraProjectKey(clientId?: string): Promise<string | undefined> {
  if (!clientId) return undefined;
  try {
    const mod = await import(`@/lib/clients/${clientId}/config`);
    const cfg = mod.default as ClientConfig;
    return cfg.jiraConfig?.enabled ? (cfg.jiraConfig.projectKey ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveADR(params: SaveADRParams): Promise<SavedADR> {
  let dbId = `local-${Date.now()}`;
  let dbCreatedAt = new Date().toISOString();

  // Supabase write — skipped gracefully if env vars are not set (e.g. mock / local mode)
  const supabase = tryGetSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('adrs')
      .insert({
        session_id: params.sessionId,
        requirement: params.requirement,
        verdict: params.verdict,
        scribe_notes: params.scribeNotes,
        must_fix_issues: params.mustFixIssues,
      })
      .select()
      .single();

    if (error) {
      console.warn('[adr/store] Supabase write failed (non-fatal):', error.message);
    } else {
      dbId = data.id as string;
      dbCreatedAt = data.created_at as string;
    }
  } else {
    console.warn('[adr/store] Supabase not configured — skipping DB write, proceeding to Jira');
  }

  const jiraProjectKey = await resolveJiraProjectKey(params.clientId);

  // Jira write (non-blocking — never blocks session completion)
  const jiraResult = await createADRIssue({
    requirement: params.requirement,
    verdict: params.verdict,
    scribeNotes: params.scribeNotes,
    mustFixIssues: params.mustFixIssues,
    sessionId: params.sessionId,
    projectKey: jiraProjectKey,
    confidenceLevel: params.confidenceLevel,
    humanJudgementPoints: params.humanJudgementPoints,
  }).catch(err => {
    console.error('[adr/store] Jira write failed (non-blocking):', err);
    return null;
  });

  if (jiraResult) {
    console.log(`[adr/store] ADR written to Jira: ${jiraResult.issueKey} — ${jiraResult.issueUrl}`);
  }

  return {
    id: dbId,
    sessionId: params.sessionId,
    requirement: params.requirement,
    verdict: params.verdict,
    scribeNotes: params.scribeNotes,
    mustFixIssues: params.mustFixIssues,
    createdAt: dbCreatedAt,
    jiraIssueKey: jiraResult?.issueKey,
    jiraIssueUrl: jiraResult?.issueUrl,
  };
}

export async function countersignADR(params: {
  sessionId: string;
  jiraIssueKey?: string | null;
  architectName: string;
  architectRole: string;
  timestamp: string;
}): Promise<void> {
  const supabase = tryGetSupabaseClient();
  if (supabase) {
    const { error } = await supabase
      .from('adrs')
      .update({
        countersigned_by: params.architectName,
        countersigned_role: params.architectRole,
        countersigned_at: params.timestamp,
      })
      .eq('session_id', params.sessionId);

    if (error) {
      console.warn('[adr/store] Supabase countersign update failed (non-fatal):', error.message);
    }
  }

  if (params.jiraIssueKey) {
    await updateADRSignOff({
      issueKey: params.jiraIssueKey,
      architectName: params.architectName,
      architectRole: params.architectRole,
      timestamp: params.timestamp,
    }).catch(err => {
      console.error('[adr/store] Jira sign-off update failed (non-fatal):', err);
    });
  }
}
