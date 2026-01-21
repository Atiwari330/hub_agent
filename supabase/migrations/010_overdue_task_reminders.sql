-- Migration: Create overdue_task_reminders table
-- Tracks reminder tasks created for deals with overdue HubSpot tasks

CREATE TABLE IF NOT EXISTS overdue_task_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  hubspot_deal_id TEXT NOT NULL,
  hubspot_task_id TEXT NOT NULL,
  overdue_task_count INTEGER NOT NULL,
  oldest_overdue_days INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up reminders by deal
CREATE INDEX idx_overdue_task_reminders_deal_id ON overdue_task_reminders(deal_id);

-- Index for looking up by HubSpot deal ID
CREATE INDEX idx_overdue_task_reminders_hubspot_deal_id ON overdue_task_reminders(hubspot_deal_id);

-- Index for sorting by creation time
CREATE INDEX idx_overdue_task_reminders_created_at ON overdue_task_reminders(created_at);
