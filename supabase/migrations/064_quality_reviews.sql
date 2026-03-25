-- Phase 5: Quality Layers — quality_reviews table
-- Stores quality review results for every analyzed ticket

CREATE TABLE IF NOT EXISTS quality_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
  overall_score DECIMAL(4,2) NOT NULL,
  dimension_scores JSONB NOT NULL,
  issues JSONB DEFAULT '[]',
  pass_approved BOOLEAN NOT NULL,
  refinement_triggered BOOLEAN DEFAULT FALSE,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quality_reviews_ticket ON quality_reviews(hubspot_ticket_id);
CREATE INDEX idx_quality_reviews_created ON quality_reviews(created_at);
CREATE INDEX idx_quality_reviews_score ON quality_reviews(overall_score);
