-- Deal Enrichments bridge table
-- Links deals to domain enrichments, stores deal→domain resolution metadata

CREATE TABLE deal_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id TEXT NOT NULL UNIQUE,
  domain TEXT,                          -- NULL if no company domain found
  status TEXT NOT NULL DEFAULT 'pending',
    -- enriched: domain found + enrichment complete
    -- no_contacts: deal has no associated contacts
    -- free_email_only: all contacts have free email providers
    -- failed: enrichment pipeline failed
    -- pending: not yet processed
  contact_emails TEXT[],                -- all emails found on the deal
  selected_email TEXT,                  -- the email whose domain was used
  -- Denormalized deal context (for display without re-joining)
  deal_name TEXT,
  owner_name TEXT,
  owner_id TEXT,
  stage_name TEXT,
  amount DECIMAL(15,2),
  close_date DATE,
  error_message TEXT,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_de_deal ON deal_enrichments(hubspot_deal_id);
CREATE INDEX idx_de_domain ON deal_enrichments(domain);
CREATE INDEX idx_de_status ON deal_enrichments(status);

-- RLS
ALTER TABLE deal_enrichments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view" ON deal_enrichments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role manages" ON deal_enrichments FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
