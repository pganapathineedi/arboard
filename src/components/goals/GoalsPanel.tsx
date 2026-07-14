'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { PendingGoal, Goal } from '@/lib/goals/GoalOrchestrator'

const API_KEY = process.env.NEXT_PUBLIC_ARBOARD_API_KEY ?? ''

// ── Status display maps ───────────────────────────────────────────────────────

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

// ── Design tokens (dark theme — matches existing ARBoard palette) ─────────────

const S = {
  card: {
    background: '#0f1420',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '16px 20px',
  } as React.CSSProperties,

  sectionLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.4,
    color: '#7B8DB0',
    textTransform: 'uppercase' as const,
    marginBottom: 12,
  } as React.CSSProperties,

  issueKey: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: 700,
    color: '#00c8f0',
    textDecoration: 'none',
  } as React.CSSProperties,

  summary: {
    fontSize: 13,
    color: '#F0F4FF',
    marginTop: 4,
    lineHeight: 1.5,
  } as React.CSSProperties,

  attachment: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#7B8DB0',
    marginTop: 4,
  } as React.CSSProperties,

  btn: {
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
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function GoalsPanel() {
  // Section 2 — pending tickets
  const [pendingGoals, setPendingGoals]   = useState<PendingGoal[]>([])
  const [fetchingPending, setFetchingPending] = useState(false)
  const [fetchError, setFetchError]       = useState<string | null>(null)
  const [hasFetched, setHasFetched]       = useState(false)

  // In-flight guard — single review at a time
  const [reviewInFlight, setReviewInFlight] = useState(false)
  const [initiatedKey, setInitiatedKey]     = useState<string | null>(null)
  const [triggeringKey, setTriggeringKey]   = useState<string | null>(null)
  const [triggerError, setTriggerError]     = useState<string | null>(null)

  // Section 3 — goals history
  const [history, setHistory]             = useState<Goal[]>([])
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

  // When a review is in-flight, watch for it to land in history
  useEffect(() => {
    if (!reviewInFlight || !initiatedKey) return
    const goal = history.find(g => g.jiraIssueKey === initiatedKey)
    if (goal && (goal.status === 'complete' || goal.status === 'failed')) {
      setReviewInFlight(false)
    }
  }, [history, reviewInFlight, initiatedKey])

  // ── Section 1: Fetch pending goals ──────────────────────────────────────
  const handleFetchPending = async () => {
    if (fetchingPending || reviewInFlight) return
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

  // ── Section 2: Initiate a review ────────────────────────────────────────
  const handleInitiateReview = async (goal: PendingGoal) => {
    if (reviewInFlight || triggeringKey) return
    setTriggeringKey(goal.issueKey)
    setTriggerError(null)
    try {
      const res = await fetch('/api/v1/goals/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-arboard-key': API_KEY,
        },
        body: JSON.stringify({ issueKey: goal.issueKey, triggeredBy: 'manual' }),
      })
      const body = (await res.json()) as { goalId?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // 202 accepted — pipeline running in background
      setInitiatedKey(goal.issueKey)
      setReviewInFlight(true)
      void fetchHistory() // surface the new pending row immediately

      // Notify the Forum UI and scroll up to it after a short delay
      const triggeredGoalId = body.goalId ?? ''
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('arboard:goal-triggered', {
            detail: { issueKey: goal.issueKey, goalId: triggeredGoalId },
          })
        )
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }, 1500)
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : 'Failed to trigger review')
    } finally {
      setTriggeringKey(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Section 1: Fetch Goals ─────────────────────────────────────── */}
      <div style={S.card}>
        <div style={S.sectionLabel}>Jira Review Queue</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => void handleFetchPending()}
            disabled={fetchingPending || reviewInFlight}
            style={{
              ...S.btn,
              ...(fetchingPending || reviewInFlight
                ? { opacity: 0.4, cursor: 'not-allowed' }
                : {}),
            }}
          >
            {fetchingPending ? '⟳ Fetching…' : '⬇  Fetch Jira Goals'}
          </button>

          {reviewInFlight && (
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f0a020' }}>
              ◉ Review in progress — fetch disabled until complete
            </span>
          )}

          {fetchError && (
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#e84040' }}>
              ✕ {fetchError}
            </span>
          )}
        </div>
      </div>

      {/* ── Section 2: Pending Tickets ─────────────────────────────────── */}
      {hasFetched && (
        <div>
          <div style={S.sectionLabel}>
            Pending Tickets ({pendingGoals.length})
          </div>

          {triggerError && (
            <div style={{
              fontFamily: 'monospace', fontSize: 11, color: '#e84040',
              marginBottom: 10,
              padding: '8px 12px',
              background: 'rgba(232,64,64,0.08)',
              border: '1px solid rgba(232,64,64,0.2)',
              borderRadius: 6,
            }}>
              ✕ {triggerError}
            </div>
          )}

          {pendingGoals.length === 0 ? (
            <div style={{
              ...S.card,
              color: '#7B8DB0',
              fontSize: 13,
              fontStyle: 'italic',
              textAlign: 'center',
              padding: '24px 20px',
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
                const isOtherInFlight = reviewInFlight && !isInitiated
                const isTriggering   = triggeringKey === goal.issueKey

                return (
                  <div
                    key={goal.issueKey}
                    style={{
                      ...S.card,
                      borderColor: isInitiated
                        ? 'rgba(15,186,122,0.30)'
                        : isOtherInFlight
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(255,255,255,0.07)',
                      opacity: isOtherInFlight ? 0.55 : 1,
                      transition: 'opacity 0.2s, border-color 0.2s',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 16,
                    }}>
                      {/* Left: issue metadata */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a
                          href={`${goal.jiraBaseUrl}/browse/${goal.issueKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={S.issueKey}
                        >
                          {goal.issueKey}
                        </a>
                        <div style={S.summary}>{goal.issueSummary}</div>
                        <div style={S.attachment}>📎 {goal.attachmentName}</div>
                      </div>

                      {/* Right: action */}
                      <div style={{ flexShrink: 0, minWidth: 140, textAlign: 'right' }}>
                        {isInitiated ? (
                          <div style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: '#0fba7a',
                            padding: '7px 10px',
                            background: 'rgba(15,186,122,0.08)',
                            borderRadius: 6,
                            border: '1px solid rgba(15,186,122,0.2)',
                            lineHeight: 1.6,
                            textAlign: 'left',
                          }}>
                            ✓ Review initiated
                            <br />
                            <span style={{ color: '#7B8DB0', fontSize: 10 }}>
                              Tracking in Goals History ↓
                            </span>
                          </div>
                        ) : isOtherInFlight ? (
                          <div style={{
                            fontFamily: 'monospace',
                            fontSize: 10,
                            color: '#f0a020',
                            padding: '7px 10px',
                            background: 'rgba(240,160,32,0.08)',
                            borderRadius: 6,
                            border: '1px solid rgba(240,160,32,0.2)',
                            lineHeight: 1.5,
                            textAlign: 'left',
                          }}>
                            A review is already<br />in progress
                          </div>
                        ) : (
                          <button
                            onClick={() => void handleInitiateReview(goal)}
                            disabled={isTriggering}
                            style={{
                              ...S.btn,
                              ...(isTriggering ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
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

      {/* ── Section 3: Goals History ───────────────────────────────────── */}
      <div>
        <div style={S.sectionLabel}>
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
                        background: i % 2 === 1
                          ? 'rgba(255,255,255,0.015)'
                          : 'transparent',
                      }}
                    >
                      {/* Issue Key */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#00c8f0',
                        }}>
                          {goal.jiraIssueKey}
                        </span>
                      </td>

                      {/* Summary */}
                      <td style={{ padding: '10px 14px', color: '#F0F4FF', maxWidth: 260 }}>
                        <div style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {goal.jiraIssueSummary || '—'}
                        </div>
                      </td>

                      {/* Attachment */}
                      <td style={{
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: '#7B8DB0',
                        whiteSpace: 'nowrap',
                      }}>
                        {goal.attachmentName}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={statusBadge(goal.status)}
                          className={goal.status === 'in_progress' ? 'arboard-glow-pulse' : undefined}
                        >
                          {STATUS_LABEL[goal.status] ?? goal.status}
                        </span>
                        {goal.status === 'failed' && goal.errorMessage && (
                          <div style={{
                            fontFamily: 'monospace',
                            fontSize: 9,
                            color: '#e84040',
                            marginTop: 3,
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={goal.errorMessage}
                          >
                            {goal.errorMessage}
                          </div>
                        )}
                      </td>

                      {/* Triggered By */}
                      <td style={{
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: '#7B8DB0',
                        whiteSpace: 'nowrap',
                      }}>
                        {goal.triggeredBy}
                      </td>

                      {/* Created */}
                      <td style={{
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: '#7B8DB0',
                        whiteSpace: 'nowrap',
                      }}>
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
