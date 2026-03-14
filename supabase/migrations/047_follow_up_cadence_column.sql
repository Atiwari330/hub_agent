-- Add follow_up_cadence column to ticket_support_manager_analyses
ALTER TABLE ticket_support_manager_analyses
ADD COLUMN IF NOT EXISTS follow_up_cadence TEXT;
