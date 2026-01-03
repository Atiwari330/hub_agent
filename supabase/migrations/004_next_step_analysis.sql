-- Migration: Add next step analysis fields to deals table
-- Purpose: Store LLM-extracted date information from next step text

-- Add next step analysis fields
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_due_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_action_type TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_status TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_confidence DECIMAL(3,2);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_display_message TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_analyzed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_analyzed_value TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_last_updated_at TIMESTAMP WITH TIME ZONE;

-- Index for queries on due date (for finding overdue next steps)
CREATE INDEX IF NOT EXISTS idx_deals_next_step_due_date ON deals(next_step_due_date);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_deals_next_step_status ON deals(next_step_status);

-- Add check constraint for valid status values
-- Note: Using DO block to make constraint idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_next_step_status'
  ) THEN
    ALTER TABLE deals ADD CONSTRAINT chk_next_step_status
      CHECK (next_step_status IS NULL OR next_step_status IN (
        'date_found', 'date_inferred', 'no_date', 'date_unclear',
        'awaiting_external', 'empty', 'unparseable'
      ));
  END IF;
END $$;

-- Add check constraint for valid action types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_next_step_action_type'
  ) THEN
    ALTER TABLE deals ADD CONSTRAINT chk_next_step_action_type
      CHECK (next_step_action_type IS NULL OR next_step_action_type IN (
        'demo', 'call', 'email', 'proposal', 'meeting',
        'follow_up', 'contract', 'security_review', 'other'
      ));
  END IF;
END $$;

-- Add check constraint for confidence range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_next_step_confidence'
  ) THEN
    ALTER TABLE deals ADD CONSTRAINT chk_next_step_confidence
      CHECK (next_step_confidence IS NULL OR (next_step_confidence >= 0 AND next_step_confidence <= 1));
  END IF;
END $$;
