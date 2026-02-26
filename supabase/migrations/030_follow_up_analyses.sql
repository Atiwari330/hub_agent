CREATE TABLE follow_up_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,

  -- LLM assessment
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'false_positive', 'monitoring')),
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  customer_sentiment TEXT CHECK (customer_sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),
  recommended_action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  last_meaningful_contact TEXT,
  confidence DECIMAL(3,2),

  -- Original violation context (what the timestamp rules detected)
  violation_type TEXT CHECK (violation_type IN ('no_response', 'customer_hanging', 'customer_dark')),
  original_severity TEXT CHECK (original_severity IN ('critical', 'warning', 'watch')),
  gap_hours DECIMAL(10,2),

  -- Denormalized for display
  ticket_subject TEXT,
  company_id TEXT,
  company_name TEXT,
  owner_id TEXT,
  owner_name TEXT,

  -- Metadata
  engagement_count INTEGER DEFAULT 0,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fua_ticket ON follow_up_analyses(hubspot_ticket_id);
CREATE INDEX idx_fua_status ON follow_up_analyses(status);
CREATE INDEX idx_fua_urgency ON follow_up_analyses(urgency);
CREATE INDEX idx_fua_analyzed ON follow_up_analyses(analyzed_at);

ALTER TABLE follow_up_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view follow_up_analyses"
  ON follow_up_analyses FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages follow_up_analyses"
  ON follow_up_analyses FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
