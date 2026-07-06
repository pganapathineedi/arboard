-- ARBoard Session Tracing Schema
-- schema_version: 1
-- Run via: supabase db query --linked

CREATE TABLE IF NOT EXISTS session_traces (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version            integer NOT NULL DEFAULT 1,
  session_id                uuid REFERENCES sessions(id) ON DELETE CASCADE,
  adr_id                    uuid REFERENCES adrs(id) ON DELETE SET NULL,
  client_id                 text,
  domain                    text NOT NULL DEFAULT 'salesforce',
  mode                      text NOT NULL CHECK (mode IN ('real','mock')),
  exclude_from_analytics    boolean NOT NULL DEFAULT false,
  document_hash             text,
  resubmission_of           uuid REFERENCES session_traces(id) ON DELETE SET NULL,
  resubmission_depth        integer NOT NULL DEFAULT 0,
  trace_status              text NOT NULL DEFAULT 'in_progress'
                            CHECK (trace_status IN ('in_progress','complete','partial','failed')),
  agent_count               integer,
  agents_completed          integer DEFAULT 0,
  verdict                   text,
  overall_risk              text,
  total_cost_usd            numeric(10,6),
  total_input_tokens        integer,
  total_output_tokens       integer,
  expected_token_budget     integer,
  token_budget_variance_pct numeric(6,2),
  content_hash              text,
  expires_at                timestamptz,
  pre_forum                 jsonb,
  raw_json                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  completed_at              timestamptz,
  wall_clock_ms             integer
);

CREATE TABLE IF NOT EXISTS session_trace_agents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id                 uuid NOT NULL REFERENCES session_traces(id) ON DELETE CASCADE,
  session_id               uuid NOT NULL,
  client_id                text,
  agent_id                 text NOT NULL,
  agent_name               text NOT NULL,
  model                    text NOT NULL,
  round                    integer NOT NULL DEFAULT 1,
  rebuttal_target_agent_id text,
  sequence_number          integer NOT NULL,
  status                   text NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress','success','failed','timeout','skipped')),
  error_message            text,
  duration_ms              integer,
  session_offset_ms        integer,
  wall_clock_ts            timestamptz,
  input_tokens             integer,
  output_tokens            integer,
  estimated_cost_usd       numeric(10,6),
  findings_count           integer DEFAULT 0,
  must_fix_count           integer DEFAULT 0,
  findings_summary         text[],
  dissent_position         text CHECK (dissent_position IN ('agrees','dissents','not_applicable')),
  prompt_sections          jsonb,
  episodic_delta           jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz
);

CREATE TABLE IF NOT EXISTS session_trace_injections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id          uuid NOT NULL REFERENCES session_traces(id) ON DELETE CASCADE,
  agent_trace_id    uuid NOT NULL REFERENCES session_trace_agents(id) ON DELETE CASCADE,
  client_id         text,
  layer_type        text NOT NULL CHECK (layer_type IN (
                      'well_architected','failure_patterns','domain_skill',
                      'cross_cutting_skill','episodic_memory','org_learnings',
                      'jira_memory','client_context'
                    )),
  layer_file        text,
  file_content_hash text,
  status            text NOT NULL CHECK (status IN ('injected','skipped')),
  skip_reason       text,
  keywords_checked  text[],
  keywords_matched  text[],
  pattern_ids       text[],
  org_learning_ids  text[],
  estimated_tokens  integer,
  char_count        integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes for session_traces
CREATE INDEX IF NOT EXISTS idx_st_session_id     ON session_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_st_client_id      ON session_traces(client_id);
CREATE INDEX IF NOT EXISTS idx_st_document_hash  ON session_traces(document_hash);
CREATE INDEX IF NOT EXISTS idx_st_analytics      ON session_traces(mode, exclude_from_analytics, created_at);
CREATE INDEX IF NOT EXISTS idx_st_resubmission   ON session_traces(resubmission_of);

-- Indexes for session_trace_agents
CREATE INDEX IF NOT EXISTS idx_sta_trace_id   ON session_trace_agents(trace_id);
CREATE INDEX IF NOT EXISTS idx_sta_agent_id   ON session_trace_agents(agent_id);
CREATE INDEX IF NOT EXISTS idx_sta_status     ON session_trace_agents(status);
CREATE INDEX IF NOT EXISTS idx_sta_client_id  ON session_trace_agents(client_id);
CREATE INDEX IF NOT EXISTS idx_sta_round      ON session_trace_agents(round);

-- Indexes for session_trace_injections
CREATE INDEX IF NOT EXISTS idx_sti_trace_id    ON session_trace_injections(trace_id);
CREATE INDEX IF NOT EXISTS idx_sti_layer_type  ON session_trace_injections(layer_type);
CREATE INDEX IF NOT EXISTS idx_sti_layer_file  ON session_trace_injections(layer_file);
CREATE INDEX IF NOT EXISTS idx_sti_status      ON session_trace_injections(status);
CREATE INDEX IF NOT EXISTS idx_sti_client_id   ON session_trace_injections(client_id);

-- RLS
ALTER TABLE session_traces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_trace_agents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_trace_injections ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "service_role_all_traces"
  ON session_traces FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_trace_agents"
  ON session_trace_agents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_trace_injections"
  ON session_trace_injections FOR ALL TO service_role USING (true) WITH CHECK (true);
