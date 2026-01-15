-- Migration: Create next_step_tasks table to track HubSpot tasks created for next step issues
-- This table stores a record whenever a task is created for missing/overdue next steps

CREATE TABLE IF NOT EXISTS next_step_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  hubspot_deal_id TEXT NOT NULL,
  hubspot_task_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('missing', 'overdue')),  -- Type of next step issue
  next_step_text TEXT,  -- The original next step text (for overdue tasks)
  days_overdue INTEGER,  -- How many days overdue at time of task creation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by deal_id
CREATE INDEX IF NOT EXISTS idx_next_step_tasks_deal_id ON next_step_tasks(deal_id);

-- Index for lookups by hubspot_deal_id
CREATE INDEX IF NOT EXISTS idx_next_step_tasks_hubspot_deal_id ON next_step_tasks(hubspot_deal_id);

-- Comment on table
COMMENT ON TABLE next_step_tasks IS 'Tracks HubSpot tasks created for next step issues (missing or overdue). Each record represents one task creation event.';
COMMENT ON COLUMN next_step_tasks.task_type IS 'Type of issue: missing (no next step defined) or overdue (next step past due date)';
COMMENT ON COLUMN next_step_tasks.next_step_text IS 'The original next step text, stored for overdue tasks';
