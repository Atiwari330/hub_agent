-- Add knowledge_used column to track which knowledge areas the agent retrieved during analysis
ALTER TABLE ticket_support_manager_analyses
ADD COLUMN IF NOT EXISTS knowledge_used text;
