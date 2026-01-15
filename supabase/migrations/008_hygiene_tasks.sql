-- Migration: Create hygiene_tasks table to track HubSpot tasks created for deal hygiene
-- This table stores a record whenever a hygiene task is created in HubSpot

CREATE TABLE IF NOT EXISTS hygiene_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  hubspot_deal_id TEXT NOT NULL,
  hubspot_task_id TEXT NOT NULL,
  missing_fields TEXT[] NOT NULL,  -- Array of field labels the task was created for
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by deal_id
CREATE INDEX IF NOT EXISTS idx_hygiene_tasks_deal_id ON hygiene_tasks(deal_id);

-- Index for lookups by hubspot_deal_id (useful for API queries)
CREATE INDEX IF NOT EXISTS idx_hygiene_tasks_hubspot_deal_id ON hygiene_tasks(hubspot_deal_id);

-- Comment on table
COMMENT ON TABLE hygiene_tasks IS 'Tracks HubSpot tasks created for deal hygiene issues. Each record represents one task creation event.';
COMMENT ON COLUMN hygiene_tasks.missing_fields IS 'Array of field labels (e.g., Lead Source, Products) that the task was created for';
