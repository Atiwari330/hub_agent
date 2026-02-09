-- Add MQL stage entry timestamp column
-- MQL (stage ID: 2030251) is the new first stage in the Sales Pipeline
ALTER TABLE deals ADD COLUMN IF NOT EXISTS mql_entered_at TIMESTAMPTZ;
