-- Pre-Demo Coach Queue: LLM-powered deal coaching analyses for MQL/Discovery deals
CREATE TABLE IF NOT EXISTS pre_demo_coach_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id TEXT UNIQUE NOT NULL,

  -- LLM analysis (SITUATION / NEXT / FOLLOW-UP)
  situation TEXT NOT NULL,
  next_action TEXT NOT NULL,
  follow_up TEXT,
  reasoning TEXT,
  confidence DECIMAL(3,2),

  -- Engagement counts (denormalized)
  call_count INTEGER DEFAULT 0,
  email_count INTEGER DEFAULT 0,
  meeting_count INTEGER DEFAULT 0,
  note_count INTEGER DEFAULT 0,

  -- PPL compliance (denormalized)
  is_ppl BOOLEAN DEFAULT FALSE,
  ppl_compliance DECIMAL(3,2),
  ppl_compliant_days INTEGER,
  ppl_total_days INTEGER,

  -- Deal context (denormalized for display)
  deal_name TEXT,
  stage_name TEXT,
  days_in_stage INTEGER,
  owner_id TEXT,
  owner_name TEXT,
  amount DECIMAL(15,2),
  lead_source TEXT,

  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pdca_deal ON pre_demo_coach_analyses(hubspot_deal_id);
CREATE INDEX idx_pdca_owner ON pre_demo_coach_analyses(owner_id);

ALTER TABLE pre_demo_coach_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pre_demo_coach_analyses"
  ON pre_demo_coach_analyses FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages pre_demo_coach_analyses"
  ON pre_demo_coach_analyses FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
