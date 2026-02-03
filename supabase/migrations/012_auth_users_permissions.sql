-- User profiles (links to auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(50) NOT NULL CHECK (role IN ('vp_revops', 'cmo', 'ceo')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);

-- User permissions (grants specific resource access)
CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  resource VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, resource)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_resource ON user_permissions(resource);

-- Trigger for updated_at
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can read their own permissions
CREATE POLICY "Users can view own permissions"
  ON user_permissions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage all (for admin operations)
CREATE POLICY "Service role manages profiles"
  ON user_profiles FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role manages permissions"
  ON user_permissions FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Valid resource keys (documented):
-- dashboard         - Main dashboard page
-- ae_detail         - AE detail pages
-- queue:hygiene     - Hygiene Queue
-- queue:next-step   - Next Step Queue
-- queue:overdue-tasks - Overdue Tasks Queue
-- queue:stalled-deals - Stalled Deals Queue
-- queue:stalled-upsells - Stalled Upsells Queue
-- queue:upsell-hygiene - Upsell Hygiene Queue
-- queue:ppl-sequence - PPL Sequence Queue
-- api:agent         - Agent API endpoint
