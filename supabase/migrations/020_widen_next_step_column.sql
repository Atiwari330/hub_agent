-- Widen next_step column from VARCHAR(500) to TEXT
-- Reason: AEs use next_step as a running log, and some deals exceed 500 chars
-- (e.g., deal 42824615766 has 631 chars), which causes the entire batch upsert to fail
ALTER TABLE deals ALTER COLUMN next_step TYPE TEXT;
