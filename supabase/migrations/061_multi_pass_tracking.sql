-- Phase 2: Multi-Pass Analysis tracking
-- Track when each pass was last run for a ticket

ALTER TABLE ticket_action_board_analyses
  ADD COLUMN IF NOT EXISTS pass_versions JSONB DEFAULT '{}';

-- Store individual pass results for history (used by Phase 7: Contextual Memory)
CREATE TABLE IF NOT EXISTS analysis_pass_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL REFERENCES support_tickets(hubspot_ticket_id) ON DELETE CASCADE,
  pass_type TEXT NOT NULL,
  result JSONB NOT NULL,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_pass_per_ticket_time UNIQUE (hubspot_ticket_id, pass_type, created_at)
);

CREATE INDEX IF NOT EXISTS idx_pass_results_ticket ON analysis_pass_results(hubspot_ticket_id, pass_type);
CREATE INDEX IF NOT EXISTS idx_pass_results_created ON analysis_pass_results(created_at);
