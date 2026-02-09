-- Add hubspot_owner_id to user_profiles for AE-to-owner linkage
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hubspot_owner_id VARCHAR(50);

-- Update role check constraint to include account_executive
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('vp_revops', 'cmo', 'ceo', 'account_executive'));

-- Index for looking up profiles by hubspot_owner_id
CREATE INDEX IF NOT EXISTS idx_user_profiles_hubspot_owner ON user_profiles(hubspot_owner_id);
