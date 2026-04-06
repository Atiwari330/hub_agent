-- Grant Pricing Compliance dashboard access to CEO users
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'pricing_compliance' FROM user_profiles
WHERE role IN ('ceo')
ON CONFLICT (user_id, resource) DO NOTHING;
