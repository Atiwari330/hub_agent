-- Migration: Add trigger to auto-track when next_step text changes during sync
-- Purpose: Enable staleness detection for the Next Step Queue

-- Trigger: auto-track when next_step text changes during sync
CREATE OR REPLACE FUNCTION update_next_step_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.next_step IS NOT NULL AND NEW.next_step_last_updated_at IS NULL THEN
      NEW.next_step_last_updated_at = NOW();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only fire for sync (not analysis, which also updates next_step_analyzed_at)
    IF OLD.next_step IS DISTINCT FROM NEW.next_step
       AND NEW.next_step_analyzed_at IS NOT DISTINCT FROM OLD.next_step_analyzed_at THEN
      NEW.next_step_last_updated_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS trg_next_step_updated ON deals;

CREATE TRIGGER trg_next_step_updated
BEFORE INSERT OR UPDATE ON deals
FOR EACH ROW
EXECUTE FUNCTION update_next_step_timestamp();

-- Backfill: give unanalyzed deals a starting timestamp so staleness works immediately
UPDATE deals
SET next_step_last_updated_at = NOW()
WHERE next_step IS NOT NULL
  AND next_step_last_updated_at IS NULL;
