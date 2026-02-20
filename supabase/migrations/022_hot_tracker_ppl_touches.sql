-- Add PPL first-week touches columns to hot_tracker_snapshots
ALTER TABLE hot_tracker_snapshots ADD COLUMN IF NOT EXISTS ppl_deals_count INT NOT NULL DEFAULT 0;
ALTER TABLE hot_tracker_snapshots ADD COLUMN IF NOT EXISTS ppl_touches_total INT NOT NULL DEFAULT 0;
