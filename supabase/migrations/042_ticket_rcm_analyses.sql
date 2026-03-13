-- RCM/Billing Ticket Audit: per-ticket analysis results
CREATE TABLE IF NOT EXISTS ticket_rcm_analyses (
  hubspot_ticket_id TEXT PRIMARY KEY,
  is_rcm_related BOOLEAN NOT NULL DEFAULT false,
  rcm_system TEXT CHECK (rcm_system IN ('practice_suite', 'opus_rcm', 'unknown', 'both')),
  issue_category TEXT CHECK (issue_category IN (
    'claim_denial', 'encounter_sync', 'era_remittance', 'insurance_entry',
    'cpt_npi_config', 'billing_rules', 'payment_posting', 'vendor_issue', 'other'
  )),
  issue_summary TEXT,
  problems TEXT[],
  severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  current_status TEXT CHECK (current_status IN ('active', 'stalled', 'waiting_vendor', 'waiting_customer', 'resolved')),
  vendor_blamed BOOLEAN,
  confidence FLOAT,
  ticket_subject TEXT,
  company_name TEXT,
  assigned_rep TEXT,
  is_closed BOOLEAN,
  analyzed_at TIMESTAMPTZ DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_rcm_analyses_rcm_related ON ticket_rcm_analyses (is_rcm_related) WHERE is_rcm_related = true;
CREATE INDEX IF NOT EXISTS idx_rcm_analyses_system ON ticket_rcm_analyses (rcm_system);
CREATE INDEX IF NOT EXISTS idx_rcm_analyses_category ON ticket_rcm_analyses (issue_category);
