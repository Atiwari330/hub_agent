-- PPL Cadence Analysis Results
-- Stores pre-computed PPL cadence analysis results for the dashboard

CREATE TABLE ppl_cadence_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  deal_name TEXT,
  amount NUMERIC,
  stage_name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  close_date TIMESTAMPTZ,
  create_date TIMESTAMPTZ,
  deal_age_days INTEGER,

  -- Pre-computed metrics (JSONB for flexibility)
  metrics JSONB NOT NULL DEFAULT '{}',

  -- LLM pass outputs
  three_compliance TEXT,
  three_rationale TEXT,
  two_compliance TEXT,
  two_rationale TEXT,
  one_compliance TEXT,
  one_rationale TEXT,
  speed_rating TEXT,
  speed_rationale TEXT,
  channel_diversity_rating TEXT,
  prospect_engagement TEXT,
  nurture_window TEXT,
  engagement_insight TEXT,
  verdict TEXT NOT NULL,
  coaching TEXT,
  risk_flag BOOLEAN DEFAULT FALSE,
  engagement_risk BOOLEAN DEFAULT FALSE,
  executive_summary TEXT,
  timeline TEXT,

  -- Metadata
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id UUID,

  UNIQUE(deal_id, analyzed_at)
);

CREATE INDEX idx_ppl_results_owner ON ppl_cadence_results(owner_id);
CREATE INDEX idx_ppl_results_verdict ON ppl_cadence_results(verdict);
CREATE INDEX idx_ppl_results_analyzed ON ppl_cadence_results(analyzed_at DESC);

-- View for latest results per deal
CREATE OR REPLACE VIEW ppl_cadence_latest AS
SELECT DISTINCT ON (deal_id) *
FROM ppl_cadence_results
ORDER BY deal_id, analyzed_at DESC;
