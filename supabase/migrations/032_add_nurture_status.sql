-- Add 'nurture' to the deal_coach_analyses status constraint.
-- Must run BEFORE any analysis returns 'nurture' or the upsert will fail.

ALTER TABLE deal_coach_analyses DROP CONSTRAINT deal_coach_analyses_status_check;
ALTER TABLE deal_coach_analyses ADD CONSTRAINT deal_coach_analyses_status_check
  CHECK (status IN ('needs_action', 'on_track', 'at_risk', 'stalled', 'no_action_needed', 'nurture'));
