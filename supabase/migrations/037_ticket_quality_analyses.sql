-- Migration: 037_ticket_quality_analyses.sql
-- Support Ticket Quality Analysis Pipeline
-- Stores per-ticket quality assessments for support handling evaluation.

CREATE TABLE IF NOT EXISTS ticket_quality_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,

  -- Overall quality score (0-100) and letter grade
  overall_quality_score INTEGER NOT NULL,
  quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A', 'B', 'C', 'D', 'F')),

  -- Dimension scores (0-10 each)
  rep_competence_score INTEGER NOT NULL CHECK (rep_competence_score BETWEEN 0 AND 10),
  communication_score INTEGER NOT NULL CHECK (communication_score BETWEEN 0 AND 10),
  resolution_score INTEGER NOT NULL CHECK (resolution_score BETWEEN 0 AND 10),
  efficiency_score INTEGER NOT NULL CHECK (efficiency_score BETWEEN 0 AND 10),

  -- Categorical assessments
  customer_sentiment TEXT NOT NULL CHECK (customer_sentiment IN
    ('very_negative', 'negative', 'neutral', 'positive', 'very_positive')),
  resolution_status TEXT NOT NULL CHECK (resolution_status IN
    ('fully_resolved', 'partially_resolved', 'workaround', 'unresolved', 'escalated', 'pending')),
  handling_quality TEXT NOT NULL CHECK (handling_quality IN
    ('excellent', 'good', 'adequate', 'poor', 'very_poor')),

  -- LLM-generated text assessments
  rep_assessment TEXT NOT NULL,
  communication_assessment TEXT NOT NULL,
  resolution_assessment TEXT NOT NULL,
  efficiency_assessment TEXT NOT NULL,
  key_observations TEXT NOT NULL,
  improvement_areas TEXT,

  -- Engagement stats
  email_count INTEGER DEFAULT 0,
  note_count INTEGER DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  meeting_count INTEGER DEFAULT 0,
  touch_count INTEGER DEFAULT 0,

  -- Denormalized context for aggregation queries
  ticket_subject TEXT,
  company_id TEXT,
  company_name TEXT,
  ticket_created_at TIMESTAMPTZ,
  is_closed BOOLEAN DEFAULT FALSE,
  primary_category TEXT,
  severity TEXT,
  assigned_rep TEXT,

  -- Metadata
  confidence DECIMAL(3,2),
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_tqa_ticket ON ticket_quality_analyses(hubspot_ticket_id);
CREATE INDEX idx_tqa_quality ON ticket_quality_analyses(overall_quality_score);
CREATE INDEX idx_tqa_grade ON ticket_quality_analyses(quality_grade);
CREATE INDEX idx_tqa_sentiment ON ticket_quality_analyses(customer_sentiment);
CREATE INDEX idx_tqa_resolution ON ticket_quality_analyses(resolution_status);
CREATE INDEX idx_tqa_rep ON ticket_quality_analyses(assigned_rep);
CREATE INDEX idx_tqa_analyzed ON ticket_quality_analyses(analyzed_at);
CREATE INDEX idx_tqa_company ON ticket_quality_analyses(company_id);

-- Row Level Security
ALTER TABLE ticket_quality_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ticket_quality_analyses"
  ON ticket_quality_analyses FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages ticket_quality_analyses"
  ON ticket_quality_analyses FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
