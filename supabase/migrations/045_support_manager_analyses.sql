-- Support Manager Queue: LLM-generated triage analyses for support tickets
CREATE TABLE IF NOT EXISTS ticket_support_manager_analyses (
  hubspot_ticket_id TEXT PRIMARY KEY,
  -- Row-level fields
  issue_summary TEXT NOT NULL,
  next_action TEXT NOT NULL,
  action_owner TEXT CHECK (action_owner IN ('Support Agent','Engineering','Customer','Support Manager')),
  urgency TEXT CHECK (urgency IN ('critical','high','medium','low')),
  -- Expanded detail fields
  reasoning TEXT,
  engagement_summary TEXT,
  linear_summary TEXT,
  days_since_last_activity INT,
  last_activity_by TEXT,
  -- Denormalized metadata
  ticket_subject TEXT,
  company_name TEXT,
  assigned_rep TEXT,
  age_days INT,
  is_closed BOOLEAN DEFAULT FALSE,
  has_linear BOOLEAN DEFAULT FALSE,
  linear_state TEXT,
  -- Meta
  confidence FLOAT,
  analyzed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sma_urgency ON ticket_support_manager_analyses (urgency);
CREATE INDEX IF NOT EXISTS idx_sma_action_owner ON ticket_support_manager_analyses (action_owner);
