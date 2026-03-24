-- Co-Destiny (VIP) flag for companies and support tickets

-- Add to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_co_destiny BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_companies_co_destiny ON companies(is_co_destiny) WHERE is_co_destiny = TRUE;

-- Denormalize onto support_tickets for fast access during analysis
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS is_co_destiny BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_tickets_co_destiny ON support_tickets(is_co_destiny) WHERE is_co_destiny = TRUE;
