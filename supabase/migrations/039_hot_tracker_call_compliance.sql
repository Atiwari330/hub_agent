-- Add PPL daily call compliance columns to hot_tracker_snapshots
-- Metric 6: 2 calls/day compliance for PPL deals (first 7 days)

ALTER TABLE hot_tracker_snapshots
  ADD COLUMN IF NOT EXISTS ppl_call_compliance_deals_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ppl_call_compliance_sum NUMERIC DEFAULT 0;
