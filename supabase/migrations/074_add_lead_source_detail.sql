-- Add lead_source_detail column to deals table.
-- Maps to HubSpot property: lead_source_detail__sync_ (Lead Source Detail (Sync))
-- Needed to distinguish Co-Destiny visits from Channel Partner referrals,
-- both of which share Lead Source = "Partner Referral".

ALTER TABLE deals ADD COLUMN IF NOT EXISTS lead_source_detail VARCHAR(255);

-- Add lead_source_detail_values to strategic_initiatives for detail-level matching.
-- When populated, initiative matching requires BOTH lead_source AND detail to match.
ALTER TABLE strategic_initiatives
  ADD COLUMN IF NOT EXISTS lead_source_detail_values TEXT[];

-- Update initiative lead source mappings to match actual HubSpot values.
-- Travis set up: Lead Source = "Partner Referral", Detail = "co_destiny_visit"
UPDATE strategic_initiatives
SET
  lead_source_values = ARRAY['Partner Referral'],
  lead_source_detail_values = ARRAY['co_destiny_visit']
WHERE name = 'Co-Destiny Referrals';

UPDATE strategic_initiatives
SET
  lead_source_values = ARRAY['Partner Referral'],
  lead_source_detail_values = NULL
WHERE name = 'CEO Channel Partners';
