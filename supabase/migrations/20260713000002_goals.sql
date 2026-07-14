-- ============================================================
-- ARBoard Goals Table
-- Tracks every Jira-triggered review goal with full lifecycle
-- state, audit trail, and autonomy-ready design.
--
-- Relationship:
--   goals (parent) → sessions (child, nullable)
--   One goal can have zero or one session
--   session_id is null if pipeline never initiated
--   session_id is populated when ForumOrchestrator starts
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Jira ticket context
  jira_issue_key        TEXT NOT NULL,
  jira_issue_id         TEXT NOT NULL,
  jira_issue_summary    TEXT,
  jira_base_url         TEXT NOT NULL,

  -- Attachment context
  attachment_id         TEXT NOT NULL,
  attachment_name       TEXT NOT NULL,
  attachment_url        TEXT NOT NULL,

  -- Lifecycle status
  -- pending     = picked up from Jira, not yet processing
  -- in_progress = pipeline initiated, Jira label set
  -- complete    = Judge verdict posted, Jira label set
  -- failed      = pipeline error, Jira label set
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'in_progress',
                            'complete',
                            'failed'
                          )),

  -- Trigger source (manual now, scheduled future)
  triggered_by          TEXT NOT NULL DEFAULT 'manual'
                          CHECK (triggered_by IN (
                            'manual',
                            'scheduled'
                          )),

  -- FK to sessions — nullable by design
  -- null = pipeline never initiated (failed before start)
  -- populated = pipeline started, full audit trail available
  session_id            UUID REFERENCES sessions(id)
                          ON DELETE SET NULL,

  -- Retry tracking
  retry_count           INT NOT NULL DEFAULT 0,
  error_message         TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Idempotency constraint
-- Prevents duplicate active goals for the same Jira ticket
-- A ticket can only have ONE pending or in_progress goal
-- at any time — enforced at DB level, not just app level
-- ============================================================
CREATE UNIQUE INDEX idx_goals_unique_active
  ON goals (jira_issue_key)
  WHERE status IN ('pending', 'in_progress');

-- ============================================================
-- Indexes
-- ============================================================

-- Queue query: fetch all pending goals
CREATE INDEX idx_goals_status
  ON goals(status);

-- Jira key lookups
CREATE INDEX idx_goals_jira_issue_key
  ON goals(jira_issue_key);

-- Session joins
CREATE INDEX idx_goals_session_id
  ON goals(session_id);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW
  EXECUTE FUNCTION update_goals_updated_at();
