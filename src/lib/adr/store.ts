import { createHash } from 'crypto';
import { getSupabaseClient } from '@/lib/supabase/client';
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
  skipJira?: boolean;
  // Token + cost metrics
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  estimatedCostUsd?: number;
  durationSeconds?: number;
  agentCount?: number;
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

function hashRequirement(req: string): string {
  return createHash('sha256').update(req).digest('hex').substring(0, 16);
}

export async function saveADR(params: SaveADRParams): Promise<SavedADR> {
  let dbId = `local-${Date.now()}`;
  let dbCreatedAt = new Date().toISOString();

  const supabase = getSupabaseClient();
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
      console.warn('[adr/store] Supabase adrs write failed (non-fatal):', error.message);
    } else {
      dbId = data.id as string;
      dbCreatedAt = data.created_at as string;
    }
  } else {
    console.warn('[adr/store] Supabase not configured — skipping DB write, proceeding to Jira');
  }

  const jiraProjectKey = await resolveJiraProjectKey(params.clientId);

  const jiraResult = params.skipJira
    ? null
    : await createADRIssue({
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

  // Non-blocking sessions record — captures metrics without gating the response
  if (supabase) {
    supabase.from('sessions').insert({
      id: params.sessionId,
      client_id: params.clientId ?? null,
      requirement: params.requirement,
      requirement_hash: hashRequirement(params.requirement),
      round_number: 1,
      status: 'completed',
      jira_issue_key: jiraResult?.issueKey ?? null,
      jira_issue_url: jiraResult?.issueUrl ?? null,
      confidence_level: params.confidenceLevel ?? null,
      verdict: params.verdict,
      input_tokens: Math.round(params.totalInputTokens ?? 0),
      output_tokens: Math.round(params.totalOutputTokens ?? 0),
      cache_read_tokens: Math.round(params.totalCacheReadTokens ?? 0),
      cache_write_tokens: Math.round(params.totalCacheWriteTokens ?? 0),
      estimated_cost_usd: params.estimatedCostUsd ?? 0,
      duration_seconds: Math.round(params.durationSeconds ?? 0),
      agent_count: Math.round(params.agentCount ?? 0),
    }).then(({ error }) => {
      if (error) console.warn('[adr/store] sessions insert failed (non-fatal):', error.message);
    });
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
  const supabase = getSupabaseClient();
  if (supabase) {
    const [{ error: adrError }, { error: signoffError }] = await Promise.all([
      supabase
        .from('adrs')
        .update({
          countersigned_by: params.architectName,
          countersigned_role: params.architectRole,
          countersigned_at: params.timestamp,
        })
        .eq('session_id', params.sessionId),
      supabase.from('signoffs').insert({
        session_id: params.sessionId,
        architect_name: params.architectName,
        architect_role: params.architectRole,
        signed_at: params.timestamp,
      }),
    ]);

    if (adrError) console.warn('[adr/store] adrs countersign failed (non-fatal):', adrError.message);
    if (signoffError) console.warn('[adr/store] signoffs insert failed (non-fatal):', signoffError.message);
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
