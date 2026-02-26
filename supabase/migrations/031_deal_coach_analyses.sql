CREATE TABLE deal_coach_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id TEXT UNIQUE NOT NULL,

  -- LLM assessment
  status TEXT NOT NULL CHECK (status IN ('needs_action', 'on_track', 'at_risk', 'stalled', 'no_action_needed')),
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  buyer_sentiment TEXT CHECK (buyer_sentiment IN ('positive', 'engaged', 'neutral', 'unresponsive', 'negative')),
  deal_momentum TEXT CHECK (deal_momentum IN ('accelerating', 'steady', 'slowing', 'stalled')),
  recommended_action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  confidence DECIMAL(3,2),
  key_risk TEXT,

  -- Denormalized context (for display without re-computing)
  deal_name TEXT,
  stage_name TEXT,
  days_in_stage INTEGER,
  owner_id TEXT,
  owner_name TEXT,
  amount DECIMAL(15,2),
  close_date DATE,
  email_count INTEGER DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  meeting_count INTEGER DEFAULT 0,
  note_count INTEGER DEFAULT 0,

  -- Metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dca_deal ON deal_coach_analyses(hubspot_deal_id);
CREATE INDEX idx_dca_status ON deal_coach_analyses(status);
CREATE INDEX idx_dca_urgency ON deal_coach_analyses(urgency);
CREATE INDEX idx_dca_momentum ON deal_coach_analyses(deal_momentum);
CREATE INDEX idx_dca_owner ON deal_coach_analyses(owner_id);
CREATE INDEX idx_dca_analyzed ON deal_coach_analyses(analyzed_at);

ALTER TABLE deal_coach_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view deal_coach_analyses"
  ON deal_coach_analyses FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages deal_coach_analyses"
  ON deal_coach_analyses FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
