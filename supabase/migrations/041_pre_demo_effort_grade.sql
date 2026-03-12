-- Pre-Demo AE Effort Grade: additional columns on deal_intelligence

-- Grade type discriminator
ALTER TABLE deal_intelligence
  ADD COLUMN IF NOT EXISTS grade_type TEXT NOT NULL DEFAULT 'deal_health';
  -- 'pre_demo_effort' | 'deal_health'

-- Pre-demo dimension scores (0-100)
ALTER TABLE deal_intelligence
  ADD COLUMN IF NOT EXISTS call_frequency_score INTEGER,
  ADD COLUMN IF NOT EXISTS call_spacing_score INTEGER,
  ADD COLUMN IF NOT EXISTS followup_regularity_score INTEGER,
  ADD COLUMN IF NOT EXISTS giftology_score INTEGER,
  ADD COLUMN IF NOT EXISTS email_personalization_score INTEGER,
  ADD COLUMN IF NOT EXISTS tactic_diversity_score INTEGER;

-- Pre-demo raw metrics
ALTER TABLE deal_intelligence
  ADD COLUMN IF NOT EXISTS total_calls INTEGER,
  ADD COLUMN IF NOT EXISTS connected_calls INTEGER,
  ADD COLUMN IF NOT EXISTS total_outbound_emails INTEGER,
  ADD COLUMN IF NOT EXISTS avg_call_gap_days DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS max_call_gap_days DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS distinct_call_hours INTEGER,
  ADD COLUMN IF NOT EXISTS distinct_call_days INTEGER,
  ADD COLUMN IF NOT EXISTS sent_gift BOOLEAN,
  ADD COLUMN IF NOT EXISTS max_touchpoint_gap_days DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS days_in_pre_demo INTEGER,
  ADD COLUMN IF NOT EXISTS tactics_detected TEXT[];

-- Index for grade type filtering
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_grade_type ON deal_intelligence(grade_type);
