-- Phase 7: Contextual Memory
-- Add index for efficient latest pass result lookup per ticket per pass type

CREATE INDEX IF NOT EXISTS idx_pass_results_latest
  ON analysis_pass_results(hubspot_ticket_id, pass_type, created_at DESC);
