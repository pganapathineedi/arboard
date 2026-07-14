'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { PendingGoal, Goal } from '@/lib/goals/GoalOrchestrator'
import { S } from '../styles'

const API_KEY = process.env.NEXT_PUBLIC_ARBOARD_API_KEY ?? ''

const STATUS_COLOR: Record<string, string> = {
  pending:     '#7B8DB0',
  in_progress: '#00c8f0',
  complete:    '#0fba7a',
  failed:      '#e84040',
}

const STATUS_LABEL: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  complete:    'Complete',
  failed:      'Failed',
}

function statusBadge(status: string): React.CSSProperties {
  const color = STATUS_COLOR[status] ?? '#7B8DB0'
  return {
    display: 'inline-block',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 4,
    background: `${color}18`,
    color,
    border: `1px solid ${color}33`,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const btnBase: React.CSSProperties = {
  background: '#00c8f0',
  color: '#07090f',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'monospace',
  letterSpacing: 0.5,
  transition: 'opacity 0.15s',
  whiteSpace: 'nowrap',
}

export interface JiraInputPanelProps {
  onFileReady: (file: File, jiraContext: { issueKey: string; summary: string }) => void
  onSwitchToReview: () => void
}

export function JiraInputPanel({ onFileReady, onSwitchToReview }: JiraInputPanelProps) {
  const [pendingGoals, setPendingGoals]       = useState<PendingGoal[]>([])
  const [fetchingPending, setFetchingPending] = useState(false)
  const [fetchError, setFetchError]           = useState<string | null>(null)
  const [hasFetched, setHasFetched]           = useState(false)

  const [triggeringKey, setTriggeringKey] = useState<string | null>(null)
  const [triggerError, setTriggerError]   = useState<string | null>(null)
  const [initiatedKey, setInitiatedKey]   = useState<string | null>(null)

  const [history, setHistory]               = useState<Goal[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // ── History fetch + 10-second auto-refresh ──────────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/goals', {
        headers: { 'x-arboard-key': API_KEY },
      })
      if (!res.ok) return
      const data = (await res.json()) as { goals: Goal[] }
      setHistory(data.goals)
    } catch {
      // silently ignore background refresh failures
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHistory()
    const id = setInterval(() => void fetchHistory(), 10_000)
    return () => clearInterval(id)
  }, [fetchHistory])

  // ── Fetch pending goals from Jira ───────────────────────────────────────
  const handleFetchPending = async () => {
    if (fetchingPending) return
    setFetchingPending(true)
    setFetchError(null)
    setTriggerError(null)
    try {
      const res = await fetch('/api/v1/goals/pending', {
        headers: { 'x-arboard-key': API_KEY },
      })
      const body = (await res.json()) as { goals?: PendingGoal[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setPendingGoals(body.goals ?? [])
      setHasFetched(true)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch goals')
    } finally {
      setFetchingPending(false)
    }
  }

  // ── Initiate a review for a single ticket ───────────────────────────────
  const handleInitiateReview = async (goal: PendingGoal) => {
    if (triggeringKey || initiatedKey) return
    setTriggeringKey(goal.issueKey)
    setTriggerError(null)

    try {
      // 1. Create goals audit row (fires background pipeline autonomously)
      const triggerRes = await fetch('/api/v1/goals/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-arboard-key': API_KEY,
        },
        body: JSON.stringify({ issueKey: goal.issueKey, triggeredBy: 'manual' }),
      })
      const triggerBody = (await triggerRes.json()) as { goalId?: string; error?: string }
      if (!triggerRes.ok) throw new Error(triggerBody.error ?? `HTTP ${triggerRes.status}`)

      // 2. Download docx bytes server-side (Jira credentials never reach the browser)
      const dlRes = await fetch(
        `/api/v1/goals/download?issueKey=${encodeURIComponent(goal.issueKey)}`,
        { headers: { 'x-arboard-key': API_KEY } },
      )
      if (!dlRes.ok) {
        let dlErr = `Download failed: HTTP ${dlRes.status}`
        try {
          const dlBody = (await dlRes.json()) as { error?: string }
          if (dlBody.error) dlErr = dlBody.error
        } catch { /* ignore parse error */ }
        throw new Error(dlErr)
      }
      const bytes = await dlRes.arrayBuffer()

      // 3. Construct File object
      const file = new File(
        [bytes],
        goal.attachmentName,
        { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      )

      // 4. Hand off: switch mode first so the review UI mounts, then upload
      setInitiatedKey(goal.issueKey)
      void fetchHistory()
      onSwitchToReview()
      onFileReady(file, { issueKey: goal.issueKey, summary: goal.issueSummary })
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : 'Failed to initiate review')
    } finally {
      setTriggeringKey(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Fetch button ─────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: '16px 20px' }}>
        <div style={{ ...S.label, marginBottom: 12 }}>Jira Review Queue</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => void handleFetchPending()}
            disabled={fetchingPending}
            style={{
              ...btnBase,
              ...(fetchingPending ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
            }}
          >
            {fetchingPending ? '⟳ Fetching…' : '⬇  Fetch Jira Goals'}
          </button>

          {fetchError && (
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#e84040' }}>
              ✕ {fetchError}
            </span>
          )}
        </div>
      </div>

      {/* ── Pending tickets ──────────────────────────────────────────────── */}
      {hasFetched && (
        <div>
          <div style={{ ...S.label, marginBottom: 10 }}>
            Pending Tickets ({pendingGoals.length})
          </div>

          {triggerError && (
            <div style={{
              fontFamily: 'monospace', fontSize: 11, color: '#e84040',
              marginBottom: 10, padding: '8px 12px',
              background: 'rgba(232,64,64,0.08)',
              border: '1px solid rgba(232,64,64,0.2)',
              borderRadius: 6,
            }}>
              ✕ {triggerError}
            </div>
          )}

          {pendingGoals.length === 0 ? (
            <div style={{
              ...S.card, padding: '24px 20px',
              color: '#7B8DB0', fontSize: 13,
              fontStyle: 'italic', textAlign: 'center',
            }}>
              No tickets labelled{' '}
              <code style={{ fontFamily: 'monospace', color: '#00c8f0', fontStyle: 'normal' }}>
                submitted-for-review
              </code>{' '}
              found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pendingGoals.map(goal => {
                const isInitiated    = initiatedKey === goal.issueKey
                const isOtherLocked  = !!initiatedKey && !isInitiated
                const isTriggering   = triggeringKey === goal.issueKey
                const isOtherTrigger = !!triggeringKey && !isTriggering

                return (
                  <div
                    key={goal.issueKey}
                    style={{
                      ...S.card,
                      borderColor: isInitiated
                        ? 'rgba(15,186,122,0.30)'
                        : isOtherLocked || isOtherTrigger
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(255,255,255,0.07)',
                      opacity: isOtherLocked || isOtherTrigger ? 0.55 : 1,
                      transition: 'opacity 0.2s, border-color 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>

                      {/* Left: issue metadata */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a
                          href={`${goal.jiraBaseUrl}/browse/${goal.issueKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#00c8f0', textDecoration: 'none' }}
                        >
                          {goal.issueKey}
                        </a>
                        <div style={{ fontSize: 13, color: '#F0F4FF', marginTop: 4, lineHeight: 1.5 }}>
                          {goal.issueSummary}
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#7B8DB0', marginTop: 4 }}>
                          📎 {goal.attachmentName}
                        </div>
                      </div>

                      {/* Right: action */}
                      <div style={{ flexShrink: 0, minWidth: 160, textAlign: 'right' }}>
                        {isInitiated ? (
                          <div style={{
                            fontFamily: 'monospace', fontSize: 11, color: '#0fba7a',
                            padding: '7px 10px',
                            background: 'rgba(15,186,122,0.08)',
                            borderRadius: 6,
                            border: '1px solid rgba(15,186,122,0.2)',
                            lineHeight: 1.6, textAlign: 'left',
                          }}>
                            ✓ Review initiated<br />
                            <span style={{ color: '#7B8DB0', fontSize: 10 }}>Uploading document…</span>
                          </div>
                        ) : isOtherLocked ? (
                          <div style={{
                            fontFamily: 'monospace', fontSize: 10, color: '#f0a020',
                            padding: '7px 10px',
                            background: 'rgba(240,160,32,0.08)',
                            borderRadius: 6,
                            border: '1px solid rgba(240,160,32,0.2)',
                            lineHeight: 1.5, textAlign: 'left',
                          }}>
                            A review is already<br />in progress
                          </div>
                        ) : (
                          <button
                            onClick={() => void handleInitiateReview(goal)}
                            disabled={isTriggering || isOtherTrigger}
                            style={{
                              ...btnBase,
                              ...((isTriggering || isOtherTrigger) ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                            }}
                          >
                            {isTriggering ? '⟳ Initiating…' : 'Initiate Review ▶'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Goals History ─────────────────────────────────────────────────── */}
      <div>
        <div style={{ ...S.label, marginBottom: 10 }}>
          Goals History
          {!historyLoading && (
            <span style={{ color: 'rgba(123,141,176,0.5)', marginLeft: 8, letterSpacing: 0.5 }}>
              — auto-refreshes every 10s
            </span>
          )}
        </div>

        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          {historyLoading ? (
            <div style={{ padding: '20px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <div
                className="animate-pulse"
                style={{ width: 8, height: 8, borderRadius: '50%', background: '#00c8f0' }}
              />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#7B8DB0' }}>
                Loading history…
              </span>
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: '20px', color: '#7B8DB0', fontSize: 13, fontStyle: 'italic' }}>
              No goals recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Issue Key', 'Summary', 'Attachment', 'Status', 'Triggered By', 'Created'].map(col => (
                      <th
                        key={col}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontFamily: 'monospace',
                          fontSize: 9,
                          letterSpacing: 1.2,
                          color: '#7B8DB0',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((goal, i) => (
                    <tr
                      key={goal.id}
                      style={{
                        borderBottom: i < history.length - 1
                          ? '1px solid rgba(255,255,255,0.04)'
                          : 'none',
                        background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#00c8f0' }}>
                          {goal.jiraIssueKey}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#F0F4FF', maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {goal.jiraIssueSummary || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#7B8DB0', whiteSpace: 'nowrap' }}>
                        {goal.attachmentName}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={statusBadge(goal.status)}
                          className={goal.status === 'in_progress' ? 'arboard-glow-pulse' : undefined}
                        >
                          {STATUS_LABEL[goal.status] ?? goal.status}
                        </span>
                        {goal.status === 'failed' && goal.errorMessage && (
                          <div
                            style={{
                              fontFamily: 'monospace', fontSize: 9, color: '#e84040',
                              marginTop: 3, maxWidth: 180,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={goal.errorMessage}
                          >
                            {goal.errorMessage}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#7B8DB0', whiteSpace: 'nowrap' }}>
                        {goal.triggeredBy}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#7B8DB0', whiteSpace: 'nowrap' }}>
                        {fmtDate(goal.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
