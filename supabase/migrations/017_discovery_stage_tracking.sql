-- Add discovery_entered_at column to track when deals enter the Discovery stage
-- HubSpot property: hs_v2_date_entered_138092708

ALTER TABLE deals ADD COLUMN IF NOT EXISTS discovery_entered_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_deals_discovery_entered ON deals(discovery_entered_at);
