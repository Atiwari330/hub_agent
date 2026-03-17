-- Add support_agent role to the user_profiles role check constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('vp_revops', 'cmo', 'ceo', 'account_executive', 'cs_manager', 'support_agent'));
