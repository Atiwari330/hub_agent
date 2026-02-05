-- Companies table for Customer Success data
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_company_id TEXT UNIQUE NOT NULL,
  name TEXT,
  domain TEXT,
  hubspot_owner_id TEXT,

  -- CS Health Properties
  health_score NUMERIC,
  health_score_status TEXT,  -- 'At-Risk', 'Healthy', 'Good', etc.
  sentiment TEXT,            -- 'Flagged', etc.

  -- Contract Properties
  contract_end DATE,
  contract_status TEXT,      -- 'Onboarding', 'Customer', 'Churned', etc.
  auto_renew TEXT,           -- 'Yes', 'No'

  -- Revenue Properties
  arr NUMERIC,
  mrr NUMERIC,
  total_revenue NUMERIC,

  -- Activity Properties
  last_activity_date TIMESTAMPTZ,
  next_activity_date TIMESTAMPTZ,
  latest_meeting_date TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX idx_companies_hubspot_id ON companies(hubspot_company_id);
CREATE INDEX idx_companies_health_status ON companies(health_score_status);
CREATE INDEX idx_companies_sentiment ON companies(sentiment);
CREATE INDEX idx_companies_owner ON companies(hubspot_owner_id);
CREATE INDEX idx_companies_contract_end ON companies(contract_end);
CREATE INDEX idx_companies_contract_status ON companies(contract_status);
CREATE INDEX idx_companies_arr ON companies(arr DESC NULLS LAST);

-- Composite index for at-risk query
CREATE INDEX idx_companies_at_risk ON companies(health_score_status, sentiment)
  WHERE health_score_status = 'At-Risk' OR sentiment = 'Flagged';

-- Trigger for updated_at
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read companies
CREATE POLICY "Authenticated users can view companies"
  ON companies FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can manage all
CREATE POLICY "Service role manages companies"
  ON companies FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
