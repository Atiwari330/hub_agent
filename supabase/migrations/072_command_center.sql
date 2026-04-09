-- Strategic initiatives with lead_source mapping and quarterly targets
CREATE TABLE IF NOT EXISTS strategic_initiatives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lead_source_values TEXT[] NOT NULL,        -- HubSpot lead_source values that map to this initiative
  q2_lead_target INTEGER,                     -- Expected lead (deal creation) count for Q2
  q2_deal_target INTEGER,                     -- Expected deal progression target
  q2_arr_target DECIMAL(15,2),               -- Expected ARR contribution
  weekly_lead_pace INTEGER,                   -- Expected leads per week
  weekly_deal_pace INTEGER,                   -- Expected deals per week
  owner_label TEXT,                            -- Who owns this initiative (e.g., "CEO", "Marketing")
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial initiatives
-- NOTE: Update lead_source_values to match exact HubSpot lead_source strings
INSERT INTO strategic_initiatives (name, lead_source_values, q2_lead_target, q2_arr_target, weekly_lead_pace, owner_label, description)
VALUES
  ('CEO Channel Partners', ARRAY['Channel Partner'], 30, 150000, 3, 'CEO', 'CEO-led channel partner referral program'),
  ('Co-Destiny Referrals', ARRAY['Co-Destiny'], 20, 100000, 2, 'Partnerships', 'Co-destiny referral initiative');

-- Human overrides of AI deal judgments with audit trail
CREATE TABLE IF NOT EXISTS deal_forecast_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hubspot_deal_id TEXT NOT NULL UNIQUE,
  original_likelihood TEXT,                   -- What the AI said (e.g., "likely", "at_risk")
  override_likelihood TEXT NOT NULL,          -- What the human says
  override_amount DECIMAL(15,2),             -- Optional: override deal amount for forecast
  override_close_date DATE,                   -- Optional: override expected close date
  override_reason TEXT NOT NULL,              -- Required: why the override was made
  overridden_by TEXT NOT NULL,                -- Email of person who overrode
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_forecast_overrides_deal ON deal_forecast_overrides(hubspot_deal_id);
