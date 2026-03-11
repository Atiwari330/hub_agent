-- Deal Intelligence: Consolidated deal health scores and issues
-- Combines hygiene, next step, stalled deals, overdue tasks, and LLM coaching into one table

CREATE TABLE deal_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id TEXT UNIQUE NOT NULL,
  pipeline TEXT NOT NULL,

  -- Overall grade (A/B/C/D/F) computed from dimension scores
  overall_grade TEXT NOT NULL,
  overall_score INTEGER NOT NULL,  -- 0-100

  -- Dimension scores (0-100 each)
  hygiene_score INTEGER NOT NULL,
  momentum_score INTEGER NOT NULL,
  engagement_score INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,

  -- Hygiene details
  missing_fields TEXT[],
  hygiene_compliant BOOLEAN NOT NULL DEFAULT false,

  -- Next Step details
  next_step_status TEXT,  -- compliant | missing | overdue | stale
  next_step_due_date DATE,

  -- Activity details
  days_since_activity INTEGER,
  has_future_activity BOOLEAN DEFAULT false,
  stalled_severity TEXT,  -- critical | warning | watch | null

  -- Overdue tasks
  overdue_task_count INTEGER DEFAULT 0,

  -- LLM assessment (expanded Deal Coach)
  llm_status TEXT,  -- needs_action | on_track | at_risk | stalled | nurture
  llm_urgency TEXT, -- critical | high | medium | low
  buyer_sentiment TEXT,
  deal_momentum TEXT,
  recommended_action TEXT,
  reasoning TEXT,
  key_risk TEXT,
  llm_confidence DECIMAL(3,2),

  -- Denormalized context for display
  deal_name TEXT,
  amount DECIMAL(15,2),
  stage_name TEXT,
  stage_id TEXT,
  days_in_stage INTEGER,
  close_date DATE,
  owner_id TEXT,
  owner_name TEXT,
  email_count INTEGER DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  meeting_count INTEGER DEFAULT 0,
  note_count INTEGER DEFAULT 0,

  -- Issues array: [{type, severity, message}]
  issues JSONB NOT NULL DEFAULT '[]',

  -- The single most important action
  top_action TEXT,
  top_action_type TEXT,

  -- Timestamps
  rules_computed_at TIMESTAMPTZ,
  llm_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_deal_intelligence_owner ON deal_intelligence(owner_id);
CREATE INDEX idx_deal_intelligence_grade ON deal_intelligence(overall_grade);
CREATE INDEX idx_deal_intelligence_pipeline ON deal_intelligence(pipeline);
