-- Add new deal properties columns
-- These columns store additional HubSpot deal data for dashboard display

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS hubspot_created_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS lead_source VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_activity_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_activity_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_step VARCHAR(500),
ADD COLUMN IF NOT EXISTS products VARCHAR(500),
ADD COLUMN IF NOT EXISTS deal_substage VARCHAR(100);

-- Add indexes for commonly queried columns
CREATE INDEX IF NOT EXISTS idx_deals_hubspot_created_at ON deals(hubspot_created_at);
CREATE INDEX IF NOT EXISTS idx_deals_lead_source ON deals(lead_source);
CREATE INDEX IF NOT EXISTS idx_deals_last_activity ON deals(last_activity_date);
CREATE INDEX IF NOT EXISTS idx_deals_next_activity ON deals(next_activity_date);
