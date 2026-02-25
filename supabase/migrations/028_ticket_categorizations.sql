-- Support Intel: ticket categorizations and summary tables
-- LLM-powered issue taxonomy and trend analysis

-- Table: ticket_categorizations
CREATE TABLE ticket_categorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,

  -- Taxonomy (LLM-assigned)
  primary_category TEXT NOT NULL,
  subcategory TEXT,
  affected_module TEXT,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('bug', 'feature_request', 'how_to', 'configuration', 'data_issue', 'access_issue', 'integration', 'performance')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- LLM analysis
  customer_impact TEXT,
  root_cause_hint TEXT,
  summary TEXT NOT NULL,
  tags TEXT[],

  -- Denormalized for queries/aggregation
  ticket_subject TEXT,
  company_id TEXT,
  company_name TEXT,
  ticket_created_at TIMESTAMPTZ,
  is_closed BOOLEAN DEFAULT false,

  -- Analysis metadata
  confidence DECIMAL(3,2),
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for trend queries
CREATE INDEX idx_tc_primary_cat ON ticket_categorizations(primary_category);
CREATE INDEX idx_tc_ticket_created ON ticket_categorizations(ticket_created_at);
CREATE INDEX idx_tc_company ON ticket_categorizations(company_id);
CREATE INDEX idx_tc_issue_type ON ticket_categorizations(issue_type);
CREATE INDEX idx_tc_severity ON ticket_categorizations(severity);

-- RLS Policies
ALTER TABLE ticket_categorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ticket_categorizations"
  ON ticket_categorizations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages ticket_categorizations"
  ON ticket_categorizations FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Table: support_intel_summaries
CREATE TABLE support_intel_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'weekly',

  summary_text TEXT NOT NULL,
  top_categories JSONB NOT NULL,
  emerging_issues JSONB,
  declining_issues JSONB,
  key_insights JSONB,

  total_tickets_analyzed INTEGER,
  new_tickets_in_period INTEGER,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(period_start, period_end, period_type)
);

-- RLS Policies
ALTER TABLE support_intel_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view support_intel_summaries"
  ON support_intel_summaries FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages support_intel_summaries"
  ON support_intel_summaries FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
