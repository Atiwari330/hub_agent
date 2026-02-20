ALTER TABLE hot_tracker_snapshots
  ADD COLUMN IF NOT EXISTS ppl_compliance_deals_count INTEGER NOT NULL DEFAULT 0;
