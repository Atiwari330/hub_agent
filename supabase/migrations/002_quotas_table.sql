-- Quotas table for tracking AE quarterly targets
CREATE TABLE quotas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER NOT NULL CHECK (fiscal_quarter >= 1 AND fiscal_quarter <= 4),
  quota_amount DECIMAL(15, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, fiscal_year, fiscal_quarter)
);

CREATE INDEX idx_quotas_owner ON quotas(owner_id);
CREATE INDEX idx_quotas_period ON quotas(fiscal_year, fiscal_quarter);

-- Add trigger for updated_at
CREATE TRIGGER update_quotas_updated_at
  BEFORE UPDATE ON quotas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
