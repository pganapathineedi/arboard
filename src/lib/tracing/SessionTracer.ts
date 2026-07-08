import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { getSupabaseClient } from '@/lib/supabase/client'

export type LayerType =
  | 'well_architected'
  | 'failure_patterns'
  | 'domain_skill'
  | 'cross_cutting_skill'
  | 'episodic_memory'
  | 'org_learnings'
  | 'jira_memory'
  | 'client_context'

export type AgentStatus = 'in_progress' | 'success' | 'failed' | 'timeout' | 'skipped'
export type TraceStatus = 'in_progress' | 'complete' | 'partial' | 'failed'
export type DissentPosition = 'agrees' | 'dissents' | 'not_applicable'

export interface InjectionRecord {
  layerType: LayerType
  layerFile?: string
  fileContentHash?: string
  status: 'injected' | 'skipped'
  skipReason?: string
  keywordsChecked?: string[]
  keywordsMatched?: string[]
  patternIds?: string[]
  orgLearningIds?: string[]
  estimatedTokens?: number
  charCount?: number
}

export interface AgentTraceInput {
  agentId: string
  agentName: string
  model: string
  round?: number
  rebuttaTargetAgentId?: string
  sequenceNumber: number
}

export interface AgentTraceComplete {
  findingsCount?: number
  mustFixCount?: number
  findingsSummary?: string[]
  dissentPosition?: DissentPosition
  inputTokens?: number
  outputTokens?: number
  estimatedCostUsd?: number
  promptSections?: Record<string, { populated: boolean; charCount: number }>
  episodicDelta?: { receivedFrom: string[]; findingsInjected: string[] }
}

export class SessionTracer {
  private traceId: string
  private sessionId: string
  private clientId: string
  private domain: string
  private mode: 'real' | 'mock'
  private documentHash?: string
  private resubmissionOf?: string
  private resubmissionDepth: number = 0
  private sessionStart: number
  agentCount: number = 0
  private agentsCompleted: number = 0
  private currentAgentTraceId: string | null = null
  private currentAgentStart: number | null = null
  private pendingInjections: InjectionRecord[] = []
  private preForum: Record<string, unknown> | null = null
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalCostUsd: number = 0
  private enabled: boolean = true
  private validationSummary: unknown[] | null = null

  constructor(params: {
    sessionId: string
    clientId?: string
    domain?: string
    mode: 'real' | 'mock'
    documentHash?: string
    resubmissionOf?: string
    resubmissionDepth?: number
    agentCount?: number
  }) {
    this.traceId = randomUUID()
    this.sessionId = params.sessionId
    this.clientId = params.clientId ?? 'default'
    this.domain = params.domain ?? 'salesforce'
    this.mode = params.mode
    this.documentHash = params.documentHash
    this.resubmissionOf = params.resubmissionOf
    this.resubmissionDepth = params.resubmissionDepth ?? 0
    this.agentCount = params.agentCount ?? 0
    this.sessionStart = Date.now()
  }

  getTraceId(): string { return this.traceId }

  recordPreForum(data: {
    activatedAgents: string[]
    overallRisk: string
    complexity: string
    inputTokens: number
    outputTokens: number
    durationMs: number
  }): void {
    this.preForum = data
  }

  async startSession(): Promise<void> {
    if (!this.enabled) return
    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return }
      await supabase.from('session_traces').insert({
        id: this.traceId,
        session_id: this.sessionId,
        client_id: this.clientId,
        domain: this.domain,
        mode: this.mode,
        exclude_from_analytics: this.mode === 'mock',
        document_hash: this.documentHash,
        resubmission_of: this.resubmissionOf ?? null,
        resubmission_depth: this.resubmissionDepth,
        trace_status: 'in_progress',
        agent_count: this.agentCount,
      })
    } catch (err) {
      console.warn('[tracer] startSession write failed — tracing disabled for this session:', err)
      this.enabled = false
    }
  }

  async startAgent(input: AgentTraceInput): Promise<string> {
    if (!this.enabled) return ''
    this.currentAgentTraceId = randomUUID()
    this.currentAgentStart = Date.now()
    this.pendingInjections = []
    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return '' }
      await supabase.from('session_trace_agents').insert({
        id: this.currentAgentTraceId,
        trace_id: this.traceId,
        session_id: this.sessionId,
        client_id: this.clientId,
        agent_id: input.agentId,
        agent_name: input.agentName,
        model: input.model,
        round: input.round ?? 1,
        rebuttal_target_agent_id: input.rebuttaTargetAgentId ?? null,
        sequence_number: input.sequenceNumber,
        status: 'in_progress',
        wall_clock_ts: new Date().toISOString(),
        session_offset_ms: Date.now() - this.sessionStart,
      })
    } catch (err) {
      console.warn(`[tracer] startAgent write failed for ${input.agentId}:`, err)
    }
    return this.currentAgentTraceId ?? ''
  }

  recordInjection(record: InjectionRecord): void {
    if (!this.enabled) return
    this.pendingInjections.push(record)
  }

  async completeAgent(data: AgentTraceComplete, agentTraceId?: string): Promise<void> {
    const resolvedTraceId = agentTraceId ?? this.currentAgentTraceId
    if (!this.enabled || !resolvedTraceId) return
    const durationMs = this.currentAgentStart ? Date.now() - this.currentAgentStart : null
    this.agentsCompleted++
    if (data.inputTokens) this.totalInputTokens += data.inputTokens
    if (data.outputTokens) this.totalOutputTokens += data.outputTokens
    if (data.estimatedCostUsd) this.totalCostUsd += data.estimatedCostUsd
    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return }
      await supabase.from('session_trace_agents').update({
        status: 'success',
        duration_ms: durationMs,
        input_tokens: data.inputTokens ?? null,
        output_tokens: data.outputTokens ?? null,
        estimated_cost_usd: data.estimatedCostUsd ?? null,
        findings_count: data.findingsCount ?? 0,
        must_fix_count: data.mustFixCount ?? 0,
        findings_summary: data.findingsSummary ?? [],
        dissent_position: data.dissentPosition ?? 'not_applicable',
        prompt_sections: data.promptSections ?? null,
        episodic_delta: data.episodicDelta ?? null,
        completed_at: new Date().toISOString(),
      }).eq('id', resolvedTraceId)

      if (this.pendingInjections.length > 0) {
        await supabase.from('session_trace_injections').insert(
          this.pendingInjections.map(inj => ({
            trace_id: this.traceId,
            agent_trace_id: this.currentAgentTraceId,
            client_id: this.clientId,
            layer_type: inj.layerType,
            layer_file: inj.layerFile ?? null,
            file_content_hash: inj.fileContentHash ?? null,
            status: inj.status,
            skip_reason: inj.skipReason ?? null,
            keywords_checked: inj.keywordsChecked ?? null,
            keywords_matched: inj.keywordsMatched ?? null,
            pattern_ids: inj.patternIds ?? null,
            org_learning_ids: inj.orgLearningIds ?? null,
            estimated_tokens: inj.estimatedTokens ?? null,
            char_count: inj.charCount ?? null,
          }))
        )
      }

      await supabase.from('session_traces').update({
        agents_completed: this.agentsCompleted,
      }).eq('id', this.traceId)

    } catch (err) {
      console.warn(`[tracer] completeAgent write failed:`, err)
    }
    this.currentAgentTraceId = null
    this.currentAgentStart = null
    this.pendingInjections = []
  }

  async failAgent(agentId: string, error: string): Promise<void> {
    if (!this.enabled || !this.currentAgentTraceId) return
    const durationMs = this.currentAgentStart ? Date.now() - this.currentAgentStart : null
    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return }
      await supabase.from('session_trace_agents').update({
        status: 'failed',
        error_message: error,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      }).eq('id', this.currentAgentTraceId)
    } catch (err) {
      console.warn(`[tracer] failAgent write failed for ${agentId}:`, err)
    }
    this.currentAgentTraceId = null
    this.currentAgentStart = null
    this.pendingInjections = []
  }

  recordValidationSummary(sessionId: string, validationResults: unknown[]): void {
    void sessionId
    this.validationSummary = validationResults
  }

  async finalise(params: {
    verdict?: string
    overallRisk?: string
    expectedTokenBudget?: number
    totalCacheReadTokens?: number
    totalCacheWriteTokens?: number
  }): Promise<void> {
    if (!this.enabled) return
    const wallClockMs = Date.now() - this.sessionStart
    const actualTokens = this.totalInputTokens + this.totalOutputTokens
    const variancePct = params.expectedTokenBudget
      ? Math.round(((actualTokens - params.expectedTokenBudget) / params.expectedTokenBudget) * 100)
      : null

    const rawJson = {
      traceId: this.traceId,
      sessionId: this.sessionId,
      clientId: this.clientId,
      domain: this.domain,
      mode: this.mode,
      documentHash: this.documentHash,
      preForum: this.preForum,
      verdict: params.verdict,
      overallRisk: params.overallRisk,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCacheReadTokens: params.totalCacheReadTokens ?? 0,
      totalCacheWriteTokens: params.totalCacheWriteTokens ?? 0,
      totalCostUsd: this.totalCostUsd,
      wallClockMs,
      generatedAt: new Date().toISOString(),
      validationSummary: this.validationSummary,
    }

    const contentHash = createHash('sha256')
      .update(JSON.stringify(rawJson))
      .digest('hex')

    const traceStatus: TraceStatus = this.agentsCompleted === this.agentCount
      ? 'complete'
      : this.agentsCompleted > 0 ? 'partial' : 'failed'

    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return }
      await supabase.from('session_traces').update({
        trace_status: traceStatus,
        verdict: params.verdict ?? null,
        overall_risk: params.overallRisk ?? null,
        total_cost_usd: this.totalCostUsd,
        total_input_tokens: this.totalInputTokens,
        total_output_tokens: this.totalOutputTokens,
        expected_token_budget: params.expectedTokenBudget ?? null,
        token_budget_variance_pct: variancePct,
        content_hash: contentHash,
        pre_forum: this.preForum ?? null,
        raw_json: rawJson,
        completed_at: new Date().toISOString(),
        wall_clock_ms: wallClockMs,
        agents_completed: this.agentsCompleted,
      }).eq('id', this.traceId)
      console.log(`[tracer] session finalised — traceId: ${this.traceId} status: ${traceStatus} hash: ${contentHash.slice(0, 12)}...`)
    } catch (err) {
      console.warn('[tracer] finalise write failed:', err)
    }
  }

  async linkAdr(adrId: string): Promise<void> {
    if (!this.enabled) return
    try {
      const supabase = getSupabaseClient()
      if (!supabase) { console.warn('[tracer] supabase client unavailable — skipping write'); return }
      await supabase.from('session_traces').update({ adr_id: adrId }).eq('id', this.traceId)
    } catch (err) {
      console.warn('[tracer] linkAdr write failed:', err)
    }
  }
}
