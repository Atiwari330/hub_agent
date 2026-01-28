-- Activity check cache table
-- Stores AI-generated engagement analysis results with 12h TTL
-- Used by the "Check Activity" feature in the stalled deals queue

CREATE TABLE IF NOT EXISTS activity_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  verdict VARCHAR(30) NOT NULL,
  confidence DECIMAL(3,2) NOT NULL,
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  recent_emails INTEGER NOT NULL DEFAULT 0,
  recent_calls INTEGER NOT NULL DEFAULT 0,
  recent_notes INTEGER NOT NULL DEFAULT 0,
  recent_tasks INTEGER NOT NULL DEFAULT 0,
  last_outreach_date TIMESTAMP WITH TIME ZONE,
  outreach_types TEXT[],
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  UNIQUE(deal_id)
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_activity_checks_deal_expires
  ON activity_checks(deal_id, expires_at);
