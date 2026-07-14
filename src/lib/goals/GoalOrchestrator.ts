import { getSupabaseClient } from '@/lib/supabase/client'
import { parseDocument } from '@/lib/documents/DocumentParser'
import { maybeSummarise } from '@/lib/documents/DocumentChunker'
import { ForumOrchestrator } from '@/lib/orchestrator/ForumOrchestrator'
import { buildJiraHeaders, getJiraEnv, updateJiraLabels, postJiraComment } from '@/lib/integrations/jira'
import type { ForumRequest } from '@/lib/types'

// DEV ONLY — remove before production
const DEV_TEST_ISSUE_KEY = 'ARBOARD-49'
const DEV_TEST_ATTACHMENT_ID = '10007'

const JIRA_LABEL_TRIGGER     = 'submitted-for-review'
const JIRA_LABEL_IN_PROGRESS = 'arb-review-in-progress'
const JIRA_LABEL_COMPLETE    = 'arb-reviewed'
const JIRA_LABEL_FAILED      = 'arb-review-failed'

export interface PendingGoal {
  issueKey: string
  issueId: string
  issueSummary: string
  attachmentId: string
  attachmentName: string
  attachmentUrl: string
  jiraBaseUrl: string
}

export interface GoalCreateResult {
  goalId: string
  issueKey: string
}

export interface GoalTriggerResult {
  success: boolean
  goalId: string
  issueKey: string
  error?: string
}

export interface Goal {
  id: string
  jiraIssueKey: string
  jiraIssueSummary: string
  attachmentName: string
  status: 'pending' | 'in_progress' | 'complete' | 'failed'
  triggeredBy: 'manual' | 'scheduled'
  sessionId: string | null
  retryCount: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

// ── GoalOrchestrator ──────────────────────────────────────────────────────────

export class GoalOrchestrator {
  /**
   * Query Jira for tickets labelled submitted-for-review that have a .docx attachment.
   * Returns the list for UI display — human selects which to trigger.
   */
  async fetchPendingGoals(): Promise<PendingGoal[]> {
    const env = getJiraEnv()
    if (!env) {
      console.warn('[goals] fetchPendingGoals: Jira env vars not configured')
      return []
    }
    const { domain, email, token } = env
    const jiraBaseUrl = `https://${domain}`
    const jql = encodeURIComponent(`labels = "${JIRA_LABEL_TRIGGER}" ORDER BY created DESC`)
    const url = `${jiraBaseUrl}/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,attachment`

    try {
      const res = await fetch(url, { headers: buildJiraHeaders(email, token) })
      if (!res.ok) {
        console.error('[goals] Jira search failed', res.status, await res.text())
        return []
      }

      const data = (await res.json()) as {
        issues: Array<{
          id: string
          key: string
          fields: {
            summary: string
            attachment: Array<{ id: string; filename: string; content: string }>
          }
        }>
      }

      const pending: PendingGoal[] = []
      for (const issue of data.issues) {
        const docx = issue.fields.attachment?.find(a =>
          a.filename.toLowerCase().endsWith('.docx')
        )
        if (!docx) continue
        pending.push({
          issueKey:       issue.key,
          issueId:        issue.id,
          issueSummary:   issue.fields.summary ?? '',
          attachmentId:   docx.id,
          attachmentName: docx.filename,
          attachmentUrl:  docx.content,
          jiraBaseUrl,
        })
      }
      return pending
    } catch (err) {
      console.error('[goals] fetchPendingGoals error:', err)
      return []
    }
  }

  /**
   * Step 1 of the pipeline: fetch Jira issue details and create the Supabase goal
   * row with status 'pending'. Returns immediately with the real Supabase UUID so
   * callers can return it in a 202 response before the pipeline runs.
   *
   * Throws on Jira fetch failure or Supabase insert failure.
   */
  async createGoal(
    issueKey: string,
    triggeredBy: 'manual' | 'scheduled',
  ): Promise<GoalCreateResult> {
    const env = getJiraEnv()
    if (!env) throw new Error('Jira env vars not configured')
    const { domain, email, token } = env
    const jiraBaseUrl = `https://${domain}`

    // Fetch issue details — we need them to fully populate the goal row up front
    const res = await fetch(
      `${jiraBaseUrl}/rest/api/3/issue/${issueKey}?fields=summary,attachment`,
      { headers: buildJiraHeaders(email, token) },
    )
    if (!res.ok) throw new Error(`Jira GET issue returned ${res.status}`)

    const data = (await res.json()) as {
      id: string
      fields: {
        summary: string
        attachment: Array<{ id: string; filename: string; content: string }>
      }
    }
    const docx = data.fields.attachment?.find(a =>
      a.filename.toLowerCase().endsWith('.docx')
    )
    if (!docx) throw new Error('No .docx attachment found on issue')

    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase client unavailable')

    const { data: goalRow, error: insertErr } = await sb
      .from('goals')
      .insert({
        jira_issue_key:     issueKey,
        jira_issue_id:      data.id,
        jira_issue_summary: data.fields.summary ?? '',
        jira_base_url:      jiraBaseUrl,
        attachment_id:      docx.id,
        attachment_name:    docx.filename,
        attachment_url:     docx.content,
        status:             'pending',
        triggered_by:       triggeredBy,
      })
      .select('id')
      .single()

    if (insertErr || !goalRow) {
      throw new Error(insertErr?.message ?? 'Goal insert failed')
    }

    const goalId = (goalRow as Record<string, unknown>).id as string
    return { goalId, issueKey }
  }

  /**
   * Step 2 of the pipeline: run the full review pipeline for an existing goal row.
   * Reads all attachment details from Supabase so the caller only needs to pass
   * the goalId returned by createGoal().
   */
  async executeGoal(goalId: string): Promise<GoalTriggerResult> {
    const sb = getSupabaseClient()
    if (!sb) {
      return { success: false, goalId, issueKey: '', error: 'Supabase client unavailable' }
    }

    // Load the goal row — all Jira details were persisted by createGoal()
    const { data: goalRow, error: fetchErr } = await sb
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .single()

    if (fetchErr || !goalRow) {
      return { success: false, goalId, issueKey: '', error: fetchErr?.message ?? 'Goal row not found' }
    }

    const row = goalRow as Record<string, unknown>
    const issueKey    = row.jira_issue_key as string
    const attachmentUrl = row.attachment_url as string

    const env = getJiraEnv()
    if (!env) {
      return { success: false, goalId, issueKey, error: 'Jira env vars not configured' }
    }
    const { domain, email, token } = env

    const failGoal = async (message: string) => {
      await sb.from('goals').update({ status: 'failed', error_message: message }).eq('id', goalId)
      await updateJiraLabels(issueKey, JIRA_LABEL_FAILED, [JIRA_LABEL_IN_PROGRESS], domain, email, token)
    }

    // ── 1. Mark in_progress + update Jira label (idempotency guard) ───────────
    await sb.from('goals').update({ status: 'in_progress' }).eq('id', goalId)
    await updateJiraLabels(issueKey, JIRA_LABEL_IN_PROGRESS, [JIRA_LABEL_TRIGGER], domain, email, token)

    // ── 2. Download .docx attachment bytes ────────────────────────────────────
    let buffer: Buffer
    try {
      const dlRes = await fetch(attachmentUrl, {
        headers: buildJiraHeaders(email, token, true),
      })
      if (!dlRes.ok) throw new Error(`Attachment download returned ${dlRes.status}`)
      buffer = Buffer.from(await dlRes.arrayBuffer())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attachment download failed'
      await failGoal(msg)
      return { success: false, goalId, issueKey, error: msg }
    }

    // ── 3. Extract text (same path as manual upload) ──────────────────────────
    let extractedText: string
    try {
      const rawText = await parseDocument(buffer, 'docx')
      if (!rawText.trim()) {
        const msg = 'Extracted text is empty — cannot process document'
        await failGoal(msg)
        return { success: false, goalId, issueKey, error: msg }
      }
      const summarised = await maybeSummarise(rawText)
      extractedText = summarised.text
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Text extraction failed'
      await failGoal(msg)
      return { success: false, goalId, issueKey, error: msg }
    }

    // ── 4. Run the document review pipeline ──────────────────────────────────
    const request: ForumRequest = {
      input:           extractedText,
      domainId:        'salesforce',
      documentContent: true,
      inputMode:       'review',
    }

    let judgeVerdict = ''

    try {
      for await (const chunk of ForumOrchestrator.streamForum(request, 'real')) {
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>
            if (event.type === 'session_start' && typeof event.sessionId === 'string') {
              await sb.from('goals').update({ session_id: event.sessionId }).eq('id', goalId)
            } else if (event.type === 'token' && event.agentId === 'sf-judge') {
              judgeVerdict += (event.token as string) ?? ''
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline execution failed'
      await failGoal(msg)
      return { success: false, goalId, issueKey, error: msg }
    }

    // ── 5. Mark complete, update Jira, post verdict comment ──────────────────
    await sb.from('goals').update({ status: 'complete' }).eq('id', goalId)
    await updateJiraLabels(issueKey, JIRA_LABEL_COMPLETE, [JIRA_LABEL_IN_PROGRESS], domain, email, token)

    if (judgeVerdict.trim()) {
      await postJiraComment(
        issueKey,
        `ARBoard Review Complete\n\n${judgeVerdict.slice(0, 2000)}`,
        domain,
        email,
        token,
      )
    }

    return { success: true, goalId, issueKey }
  }

  /**
   * Convenience wrapper: createGoal() then executeGoal(). Used by the cron stub
   * and any caller that doesn't need the real goalId before the pipeline starts.
   */
  async triggerGoal(
    issueKey: string,
    triggeredBy: 'manual' | 'scheduled',
  ): Promise<GoalTriggerResult> {
    let goalId: string
    try {
      const created = await this.createGoal(issueKey, triggeredBy)
      goalId = created.goalId
    } catch (err) {
      return {
        success: false,
        goalId: '',
        issueKey,
        error: err instanceof Error ? err.message : 'createGoal failed',
      }
    }
    return this.executeGoal(goalId)
  }

  /**
   * Return all goals from Supabase, newest first (up to 100).
   */
  async getGoalsHistory(): Promise<Goal[]> {
    const sb = getSupabaseClient()
    if (!sb) return []
    const { data, error } = await sb
      .from('goals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    console.log('[getGoalsHistory] data:', JSON.stringify(data, null, 2))
    console.log('[getGoalsHistory] error:', error)
    console.log('[getGoalsHistory] row count:', data?.length ?? 0)
    if (error || !data) return []
    return (data as Record<string, unknown>[]).map(row => ({
      id:               row.id as string,
      jiraIssueKey:     row.jira_issue_key as string,
      jiraIssueSummary: (row.jira_issue_summary as string | null) ?? '',
      attachmentName:   row.attachment_name as string,
      status:           row.status as Goal['status'],
      triggeredBy:      row.triggered_by as Goal['triggeredBy'],
      sessionId:        (row.session_id as string | null) ?? null,
      retryCount:       row.retry_count as number,
      errorMessage:     (row.error_message as string | null) ?? null,
      createdAt:        row.created_at as string,
      updatedAt:        row.updated_at as string,
    }))
  }
}

// CRON STUB — activate when autonomous scheduling is enabled
// Replace manual trigger with: runGoalsCycle('scheduled')
export async function runGoalsCycle(source: 'manual' | 'scheduled') {
  const orchestrator = new GoalOrchestrator()
  const pending = await orchestrator.fetchPendingGoals()
  for (const goal of pending) {
    await orchestrator.triggerGoal(goal.issueKey, source)
  }
}

// Suppress unused-variable warnings for dev constants (used in future wiring)
void DEV_TEST_ISSUE_KEY
void DEV_TEST_ATTACHMENT_ID
