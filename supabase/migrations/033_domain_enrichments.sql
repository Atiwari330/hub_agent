-- Domain Enrichments table
-- Stores AI-extracted business intelligence from company websites

CREATE TABLE domain_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  website_url TEXT,                    -- Actual URL after redirects
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, success, failed, parked, unreachable

  -- Raw data
  raw_markdown TEXT,                   -- Full scraped content
  pages_scraped TEXT[],                -- Which pages were scraped

  -- Structured extraction
  company_name TEXT,
  company_overview TEXT,
  services JSONB,                      -- [{name, description}]
  specialties TEXT[],
  team_members JSONB,                  -- [{name, title, bio}]
  community_events JSONB,              -- [{name, description, date}]
  locations TEXT[],

  -- Metadata
  source_emails TEXT[],                -- Which contact emails led to this domain
  error_message TEXT,                  -- If status is failed/unreachable
  confidence_score NUMERIC(3,2),       -- 0.00-1.00
  enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_domain_enrichments_domain ON domain_enrichments(domain);
CREATE INDEX idx_domain_enrichments_status ON domain_enrichments(status);
