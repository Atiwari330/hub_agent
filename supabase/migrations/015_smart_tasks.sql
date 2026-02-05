-- Smart Tasks table for tracking AI-generated tasks created through the queue system
CREATE TABLE IF NOT EXISTS smart_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  hubspot_deal_id TEXT,
  hubspot_company_id TEXT,
  hubspot_task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  queue_type TEXT NOT NULL,  -- 'hygiene', 'next-step', 'cs-hygiene', 'other'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups by deal
CREATE INDEX IF NOT EXISTS idx_smart_tasks_deal_id ON smart_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_smart_tasks_hubspot_deal_id ON smart_tasks(hubspot_deal_id);

-- Index for faster lookups by company
CREATE INDEX IF NOT EXISTS idx_smart_tasks_company_id ON smart_tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_smart_tasks_hubspot_company_id ON smart_tasks(hubspot_company_id);
