-- Ticket trainer analyses for the Support Trainer queue
-- Stores AI-generated training breakdowns for new support hires

CREATE TABLE IF NOT EXISTS ticket_trainer_analyses (
  hubspot_ticket_id TEXT PRIMARY KEY,
  customer_ask TEXT NOT NULL,
  problem_breakdown TEXT NOT NULL,
  system_explanation TEXT NOT NULL,
  interaction_timeline TEXT NOT NULL,
  resolution_approach TEXT NOT NULL,
  coaching_tips TEXT NOT NULL,
  knowledge_areas TEXT,
  difficulty_level TEXT NOT NULL CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  -- Denormalized metadata
  ticket_subject TEXT,
  company_name TEXT,
  assigned_rep TEXT,
  age_days INTEGER,
  is_closed BOOLEAN DEFAULT FALSE,
  has_linear BOOLEAN DEFAULT FALSE,
  linear_state TEXT,
  -- Analysis metadata
  confidence NUMERIC(3,2) DEFAULT 0.50,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for difficulty-based sorting
CREATE INDEX IF NOT EXISTS idx_ticket_trainer_analyses_difficulty
  ON ticket_trainer_analyses (difficulty_level);
