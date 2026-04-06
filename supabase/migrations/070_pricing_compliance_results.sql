-- Pricing Compliance Results
-- Tracks whether AEs send pricing in writing within 24 hours of demo completion

CREATE TABLE pricing_compliance_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  deal_name TEXT,
  amount NUMERIC,
  stage_name TEXT,
  owner_id TEXT,
  owner_name TEXT,

  -- Timing
  demo_completed_at TIMESTAMPTZ,
  demo_detected_via TEXT,              -- 'stage_move' | 'meeting_engagement'
  pricing_sent_at TIMESTAMPTZ,
  hours_to_pricing NUMERIC,
  exemption_noted_at TIMESTAMPTZ,

  -- LLM analysis outputs
  compliance_status TEXT NOT NULL,     -- COMPLIANT | PENDING | EXEMPT | NON_COMPLIANT | STALE_STAGE
  pricing_evidence TEXT,
  exemption_reason TEXT,
  analysis_rationale TEXT,
  executive_summary TEXT,
  risk_level TEXT,                     -- LOW | MEDIUM | HIGH

  -- Raw context for debugging
  context_snapshot JSONB DEFAULT '{}',

  -- Metadata
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id UUID,

  UNIQUE(deal_id, analyzed_at)
);

CREATE INDEX idx_pricing_compliance_owner ON pricing_compliance_results(owner_id);
CREATE INDEX idx_pricing_compliance_status ON pricing_compliance_results(compliance_status);
CREATE INDEX idx_pricing_compliance_analyzed ON pricing_compliance_results(analyzed_at DESC);

-- View for latest results per deal
CREATE OR REPLACE VIEW pricing_compliance_latest AS
SELECT DISTINCT ON (deal_id) *
FROM pricing_compliance_results
ORDER BY deal_id, analyzed_at DESC;
