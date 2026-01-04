-- Migration: Add exception contexts table and enhance deal_notes
-- Purpose: Support AI-generated contextual summaries for exception deals

-- Add author tracking to deal_notes (for context: "Note from Sarah")
ALTER TABLE deal_notes
ADD COLUMN IF NOT EXISTS author_name VARCHAR(255);

-- Exception context cache table
-- Stores AI-generated diagnosis, activity summary, and recommended actions
CREATE TABLE IF NOT EXISTS exception_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  exception_type VARCHAR(50) NOT NULL,

  -- AI-generated content
  diagnosis TEXT NOT NULL,
  recent_activity TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  urgency VARCHAR(20) NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Metadata
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  notes_hash VARCHAR(64), -- MD5 of note IDs to detect changes

  -- Ensure one context per deal per exception type
  UNIQUE(deal_id, exception_type)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_exception_contexts_deal ON exception_contexts(deal_id);
CREATE INDEX IF NOT EXISTS idx_exception_contexts_expires ON exception_contexts(expires_at);
CREATE INDEX IF NOT EXISTS idx_exception_contexts_type ON exception_contexts(exception_type);
