-- Pitch analyses table for Pitch Queue feature
-- Stores LLM-generated upsell opportunity assessments per support ticket
CREATE TABLE pitch_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,
  company_id TEXT,
  company_name TEXT,
  contact_name TEXT,
  contact_email TEXT,
  ticket_subject TEXT,
  recommendation TEXT CHECK (recommendation IN ('pitch', 'skip', 'maybe')),
  confidence DECIMAL(3,2),
  talking_points TEXT,
  reasoning TEXT,
  customer_sentiment TEXT CHECK (customer_sentiment IN ('positive', 'neutral', 'negative')),
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for joining with support_tickets
CREATE INDEX idx_pitch_analyses_ticket ON pitch_analyses(hubspot_ticket_id);

-- RLS Policies
ALTER TABLE pitch_analyses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read pitch_analyses
CREATE POLICY "Authenticated users can view pitch_analyses"
  ON pitch_analyses FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can manage all
CREATE POLICY "Service role manages pitch_analyses"
  ON pitch_analyses FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
