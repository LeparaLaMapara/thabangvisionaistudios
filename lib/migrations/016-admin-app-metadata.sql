-- ═══ Set admin role via app_metadata (Supabase native approach) ═══
-- This is the Supabase-recommended way to handle roles.
-- app_metadata is embedded in the JWT and cannot be modified by users.
--
-- Run this once to set the initial admin. Future admins can be added via:
--   1. Supabase Dashboard → Authentication → Users → Edit user → app_metadata
--   2. Or via service role: supabase.auth.admin.updateUserById(id, { app_metadata: { role: 'admin' } })

-- Set admin role for the initial admin user
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
WHERE email = 'thabangvisionstudios@gmail.com';

-- Sync profiles.role column for consistency
UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'thabangvisionstudios@gmail.com');

-- Add role column to profiles if it doesn't exist (for secondary checks)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

-- RLS helper: function to check admin from JWT
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_admin() IS 'Check if current user has admin role in JWT app_metadata. Use in RLS policies.';
