CREATE TABLE IF NOT EXISTS org_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'salesforce',
  learning_type TEXT NOT NULL CHECK (learning_type IN ('new_learning', 'confirmed_pattern', 'anti_pattern', 'org_context')),
  content TEXT NOT NULL,
  context_key TEXT,
  context_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_learnings_domain ON org_learnings(domain);
CREATE INDEX IF NOT EXISTS idx_org_learnings_created_at ON org_learnings(created_at DESC);
