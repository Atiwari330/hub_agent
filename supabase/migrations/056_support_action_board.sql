-- Support Action Board: LLM analysis, action item tracking, shift reviews

-- 1. Action Board analyses (one per ticket)
CREATE TABLE IF NOT EXISTS ticket_action_board_analyses (
  hubspot_ticket_id TEXT PRIMARY KEY,
  situation_summary TEXT NOT NULL,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_temperature TEXT NOT NULL DEFAULT 'calm',
  temperature_reason TEXT,
  response_guidance TEXT,
  response_draft TEXT,
  context_snapshot TEXT,
  related_tickets JSONB DEFAULT '[]'::jsonb,
  hours_since_customer_waiting FLOAT,
  hours_since_last_outbound FLOAT,
  hours_since_last_activity FLOAT,
  status_tags TEXT[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(3,2) DEFAULT 0.50,
  knowledge_used TEXT,
  -- Denormalized metadata
  ticket_subject TEXT,
  company_name TEXT,
  assigned_rep TEXT,
  age_days INT,
  is_closed BOOLEAN DEFAULT false,
  has_linear BOOLEAN DEFAULT false,
  linear_state TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_board_analyses_analyzed_at ON ticket_action_board_analyses (analyzed_at);
CREATE INDEX idx_action_board_analyses_status_tags ON ticket_action_board_analyses USING GIN (status_tags);

-- 2. Action item completions (tracks agent check-offs)
CREATE TABLE IF NOT EXISTS action_item_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
  action_item_id TEXT NOT NULL,
  action_description TEXT NOT NULL,
  completed_by UUID NOT NULL REFERENCES user_profiles(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified BOOLEAN DEFAULT NULL,
  verification_note TEXT,
  UNIQUE(hubspot_ticket_id, action_item_id, completed_by)
);

CREATE INDEX idx_action_completions_ticket ON action_item_completions (hubspot_ticket_id);
CREATE INDEX idx_action_completions_user ON action_item_completions (completed_by);

-- 3. Shift reviews (per-agent per-ticket per-day acknowledgments)
CREATE TABLE IF NOT EXISTS shift_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  hubspot_ticket_id TEXT NOT NULL,
  acknowledgment_tag TEXT NOT NULL CHECK (acknowledgment_tag IN ('nothing_needed', 'i_can_action', 'needs_attention', 'blocked')),
  attention_target TEXT,
  blocked_reason TEXT,
  shift_note TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper function for extracting date from timestamptz (must be IMMUTABLE for index use)
CREATE OR REPLACE FUNCTION reviewed_date(ts TIMESTAMPTZ) RETURNS DATE AS $$
  SELECT ts::date;
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX idx_shift_reviews_user_date ON shift_reviews (user_id, reviewed_date(reviewed_at));
CREATE INDEX idx_shift_reviews_ticket ON shift_reviews (hubspot_ticket_id);
CREATE UNIQUE INDEX idx_shift_reviews_unique_daily ON shift_reviews (user_id, hubspot_ticket_id, reviewed_date(reviewed_at));

-- 4. Shift completions (logs when agent finishes full shift review)
CREATE TABLE IF NOT EXISTS shift_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  tickets_reviewed INT NOT NULL,
  tickets_total INT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_completions_user ON shift_completions (user_id, completed_at);

-- Grant support_agent permissions for this queue
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'queue:support-action-board'
FROM user_profiles
WHERE role = 'support_agent'
ON CONFLICT DO NOTHING;

-- Grant cs_manager permissions
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'queue:support-action-board'
FROM user_profiles
WHERE role = 'cs_manager'
ON CONFLICT DO NOTHING;
