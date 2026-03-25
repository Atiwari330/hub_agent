-- Migration: Action Board Progress Notes
-- Replaces the shift review tag system with free-text progress notes per ticket per shift.
-- Also adds hs_last_modified_at for "Analyze Changed" detection.

-- 1. Progress notes table
CREATE TABLE IF NOT EXISTS progress_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  hubspot_ticket_id TEXT NOT NULL,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_notes_ticket ON progress_notes (hubspot_ticket_id);
CREATE INDEX IF NOT EXISTS idx_progress_notes_user ON progress_notes (user_id);

-- One note per user per ticket per day (reuses reviewed_date() from migration 056)
CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_notes_unique_daily
  ON progress_notes (user_id, hubspot_ticket_id, reviewed_date(created_at));

-- 2. Add HubSpot last-modified timestamp to support_tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS hs_last_modified_at TIMESTAMPTZ;
