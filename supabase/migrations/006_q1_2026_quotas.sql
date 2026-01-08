-- Q1 2026 AE Quotas
-- Based on KPI documents: Team goal $675K
-- Chris: $330K, Amos: $120K, Jack: $120K, Humberto: $105K

-- Insert quotas by looking up owner IDs from email
INSERT INTO quotas (owner_id, fiscal_year, fiscal_quarter, quota_amount)
SELECT
  o.id,
  2026,
  1,
  CASE o.email
    WHEN 'cgarraffa@opusbehavioral.com' THEN 330000
    WHEN 'aboyd@opusbehavioral.com' THEN 120000
    WHEN 'jrice@opusbehavioral.com' THEN 120000
    WHEN 'atiwari@opusbehavioral.com' THEN 105000
  END
FROM owners o
WHERE o.email IN (
  'cgarraffa@opusbehavioral.com',
  'aboyd@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com'
)
ON CONFLICT (owner_id, fiscal_year, fiscal_quarter)
DO UPDATE SET
  quota_amount = EXCLUDED.quota_amount,
  updated_at = NOW();

-- Also update ae_targets table for consistency
INSERT INTO ae_targets (owner_id, fiscal_year, fiscal_quarter, target_amount)
SELECT
  o.id,
  2026,
  1,
  CASE o.email
    WHEN 'cgarraffa@opusbehavioral.com' THEN 330000
    WHEN 'aboyd@opusbehavioral.com' THEN 120000
    WHEN 'jrice@opusbehavioral.com' THEN 120000
    WHEN 'atiwari@opusbehavioral.com' THEN 105000
  END
FROM owners o
WHERE o.email IN (
  'cgarraffa@opusbehavioral.com',
  'aboyd@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com'
)
ON CONFLICT (owner_id, fiscal_year, fiscal_quarter)
DO UPDATE SET
  target_amount = EXCLUDED.target_amount,
  updated_at = NOW();
