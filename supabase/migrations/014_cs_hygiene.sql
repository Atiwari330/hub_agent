-- CS Hygiene Queue: Add qbr_notes column and tracking table

-- Add qbr_notes column to companies table for [CS] Notes property
ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbr_notes TEXT;

-- Create cs_hygiene_tasks table to track created tasks
CREATE TABLE IF NOT EXISTS cs_hygiene_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  hubspot_company_id TEXT NOT NULL,
  hubspot_task_id TEXT NOT NULL,
  missing_fields TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cs_hygiene_tasks
CREATE INDEX IF NOT EXISTS idx_cs_hygiene_tasks_company_id ON cs_hygiene_tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_cs_hygiene_tasks_hubspot_company_id ON cs_hygiene_tasks(hubspot_company_id);

-- RLS Policies for cs_hygiene_tasks
ALTER TABLE cs_hygiene_tasks ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read cs_hygiene_tasks
CREATE POLICY "Authenticated users can view cs_hygiene_tasks"
  ON cs_hygiene_tasks FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can manage all
CREATE POLICY "Service role manages cs_hygiene_tasks"
  ON cs_hygiene_tasks FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
