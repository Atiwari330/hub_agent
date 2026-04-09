-- Grant ae_deal_review permission to all account_executive users
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'ae_deal_review'
FROM user_profiles
WHERE role = 'account_executive'
ON CONFLICT (user_id, resource) DO NOTHING;
