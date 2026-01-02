-- Add stage entry timestamp columns to deals table
-- These store when deals entered key pipeline stages for weekly tracking

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS sql_entered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS demo_scheduled_entered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS demo_completed_entered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS closed_won_entered_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for weekly aggregation queries
CREATE INDEX IF NOT EXISTS idx_deals_sql_entered ON deals(sql_entered_at);
CREATE INDEX IF NOT EXISTS idx_deals_demo_scheduled_entered ON deals(demo_scheduled_entered_at);
CREATE INDEX IF NOT EXISTS idx_deals_demo_completed_entered ON deals(demo_completed_entered_at);
CREATE INDEX IF NOT EXISTS idx_deals_closed_won_entered ON deals(closed_won_entered_at);

-- Create AE targets table for tracking weekly/quarterly goals
-- Simple structure for now: $100k default per AE
CREATE TABLE IF NOT EXISTS ae_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER NOT NULL CHECK (fiscal_quarter >= 1 AND fiscal_quarter <= 4),
  target_amount DECIMAL(15, 2) NOT NULL DEFAULT 100000,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, fiscal_year, fiscal_quarter)
);

CREATE INDEX IF NOT EXISTS idx_ae_targets_owner ON ae_targets(owner_id);
CREATE INDEX IF NOT EXISTS idx_ae_targets_period ON ae_targets(fiscal_year, fiscal_quarter);

-- Add trigger for updated_at
CREATE TRIGGER update_ae_targets_updated_at
  BEFORE UPDATE ON ae_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
