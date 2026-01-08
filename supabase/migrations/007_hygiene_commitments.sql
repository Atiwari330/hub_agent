-- Queues Feature: Deal Hygiene Tracking
-- Adds hygiene commitments table and deal_collaborator field

-- Add deal_collaborator field for hygiene tracking
ALTER TABLE deals
ADD COLUMN IF NOT EXISTS deal_collaborator VARCHAR(255);

-- Hygiene commitments table
-- Tracks AE promises to complete deal hygiene by a specific date
CREATE TABLE hygiene_commitments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,

  -- Commitment details
  commitment_date DATE NOT NULL,
  committed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Status tracking
  -- pending: commitment set, not yet due
  -- completed: deal is now hygiene-compliant
  -- escalated: commitment date passed but still missing fields
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'escalated')),
  resolved_at TIMESTAMP WITH TIME ZONE,

  -- Audit trail
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queue queries
CREATE INDEX idx_hygiene_commitments_deal ON hygiene_commitments(deal_id);
CREATE INDEX idx_hygiene_commitments_owner ON hygiene_commitments(owner_id);
CREATE INDEX idx_hygiene_commitments_status ON hygiene_commitments(status);
CREATE INDEX idx_hygiene_commitments_date ON hygiene_commitments(commitment_date);
CREATE INDEX idx_hygiene_commitments_pending ON hygiene_commitments(deal_id) WHERE status = 'pending';

-- Trigger for auto-updating updated_at
CREATE TRIGGER update_hygiene_commitments_updated_at
  BEFORE UPDATE ON hygiene_commitments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
