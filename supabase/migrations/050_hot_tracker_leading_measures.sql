-- Add columns for Pipeline Engagement Coverage metric (cron-computed)
ALTER TABLE hot_tracker_snapshots
  ADD COLUMN IF NOT EXISTS engagement_coverage_touched INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_coverage_total INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_untouched_deals JSONB DEFAULT '[]'::jsonb;
