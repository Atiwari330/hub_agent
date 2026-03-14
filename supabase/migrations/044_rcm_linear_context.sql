-- Add Linear context columns to ticket_rcm_analyses
ALTER TABLE ticket_rcm_analyses
  ADD COLUMN IF NOT EXISTS linear_issue_id TEXT,
  ADD COLUMN IF NOT EXISTS linear_assessment TEXT,
  ADD COLUMN IF NOT EXISTS linear_comment_count INT,
  ADD COLUMN IF NOT EXISTS linear_state TEXT;
