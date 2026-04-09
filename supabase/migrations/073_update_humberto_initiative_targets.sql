-- Update Co-Destiny and Channel Partner initiatives with targets derived from
-- Q2 gap analysis (see docs/command-center/05-humberto-pipeline-goals.md)
--
-- Math: $518K gap → 220 leads needed → pragmatic target of 50 (25+25)
-- Both owned by Humberto as the single owner of new-channel pipeline generation.

UPDATE strategic_initiatives
SET
  q2_lead_target = 25,
  q2_arr_target = 118000,
  weekly_lead_pace = 2,
  owner_label = 'Humberto',
  description = 'Co-destiny referral initiative — in-person visits to existing customer accounts. Target is ~23% of mathematically-required leads (see gap analysis).',
  updated_at = NOW()
WHERE name = 'Co-Destiny Referrals';

UPDATE strategic_initiatives
SET
  q2_lead_target = 25,
  q2_arr_target = 118000,
  weekly_lead_pace = 2,
  owner_label = 'Humberto',
  description = 'Channel partner referral program. Target is ~23% of mathematically-required leads (see gap analysis).',
  updated_at = NOW()
WHERE name = 'CEO Channel Partners';
