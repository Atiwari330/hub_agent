ALTER TABLE hot_tracker_snapshots
  ADD COLUMN IF NOT EXISTS ppl_compliance_sum NUMERIC NOT NULL DEFAULT 0;
