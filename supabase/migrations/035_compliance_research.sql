-- Compliance Research table
-- Stores state-specific compliance requirements researched via Tavily web search + Claude synthesis

CREATE TABLE compliance_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to enrichment (unique per domain for upsert support)
  domain TEXT NOT NULL UNIQUE REFERENCES domain_enrichments(domain),
  hubspot_deal_id TEXT REFERENCES deals(hubspot_deal_id),

  -- Input context used for research
  research_context JSONB NOT NULL,  -- {state, services, specialties, locations, company_name}

  -- Research results
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, researching, completed, failed

  -- Structured findings (the main output)
  state_requirements JSONB,      -- [{requirement, description, source_url, category}]
  screening_tools JSONB,         -- [{name, description, when_required, source_url}]
  reporting_platforms JSONB,     -- [{name, description, url, state, source_url}]
  licensing_requirements JSONB,  -- [{requirement, issuing_body, description, source_url}]
  payor_requirements JSONB,     -- [{payor, requirements[], source_url}]
  documentation_standards JSONB, -- [{standard, description, applies_to, source_url}]
  accreditation_info JSONB,     -- [{body, requirement, description, source_url}]

  -- Summary
  executive_summary TEXT,        -- 2-3 paragraph overview for the sales team
  key_talking_points TEXT[],     -- Bullet points to use in conversations

  -- Raw data
  search_queries TEXT[],         -- Queries sent to Tavily
  raw_search_results JSONB,     -- Full Tavily response for auditability
  source_urls TEXT[],            -- All unique source URLs cited

  -- Metadata
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  error_message TEXT,
  researched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compliance_research_deal ON compliance_research(hubspot_deal_id);
CREATE INDEX idx_compliance_research_status ON compliance_research(status);

-- RLS
ALTER TABLE compliance_research ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read compliance_research"
  ON compliance_research FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage compliance_research"
  ON compliance_research FOR ALL TO service_role USING (true);
