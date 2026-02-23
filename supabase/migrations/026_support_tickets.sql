-- Support tickets table for Support Pulse view
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,

  -- Core (always populated)
  subject TEXT,
  source_type TEXT,                    -- EMAIL, CHAT, PHONE
  pipeline TEXT,                       -- Pipeline ID (e.g. "0" = Support)
  pipeline_stage TEXT,                 -- Stage ID
  hubspot_owner_id TEXT,
  hs_primary_company_id TEXT,          -- For GROUP BY account
  hs_primary_company_name TEXT,        -- Denormalized for display
  is_closed BOOLEAN DEFAULT FALSE,

  -- Time metrics
  time_to_close BIGINT,               -- Milliseconds (HubSpot native)
  time_to_first_reply BIGINT,         -- Milliseconds
  closed_date TIMESTAMPTZ,

  -- Classification
  priority TEXT,                       -- LOW, MEDIUM
  category TEXT,                       -- GENERAL_INQUIRY, PRODUCT_ISSUE, etc.
  ball_in_court TEXT,                  -- Customer, Support, Engineering, CSM, etc.
  software TEXT,                       -- EHR, RCM, Copilot AI, etc.
  ticket_type TEXT,                    -- External, Internal

  -- SLA + Engineering
  frt_sla_breached BOOLEAN DEFAULT FALSE,
  nrt_sla_breached BOOLEAN DEFAULT FALSE,
  linear_task TEXT,

  -- Timestamps
  hubspot_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- Key indexes
CREATE INDEX idx_tickets_company ON support_tickets(hs_primary_company_id);
CREATE INDEX idx_tickets_is_closed ON support_tickets(is_closed);
CREATE INDEX idx_tickets_created ON support_tickets(hubspot_created_at);
CREATE INDEX idx_tickets_open_by_company
  ON support_tickets(hs_primary_company_id, hubspot_created_at)
  WHERE is_closed = FALSE;

-- Trigger for updated_at
CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read support_tickets
CREATE POLICY "Authenticated users can view support_tickets"
  ON support_tickets FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can manage all
CREATE POLICY "Service role manages support_tickets"
  ON support_tickets FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
