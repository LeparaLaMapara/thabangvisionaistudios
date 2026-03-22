-- ─── Add role column to profiles ─────────────────────────────────────────────
-- Moves admin access control from hardcoded ADMIN_EMAILS to a database column.
-- Valid roles: 'user' (default), 'admin', 'moderator'

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'moderator'));

-- Set the existing admin
UPDATE profiles
  SET role = 'admin'
  WHERE id IN (
    SELECT id FROM auth.users WHERE email = 'thabangvisionstudios@gmail.com'
  );

COMMENT ON COLUMN profiles.role IS 'User role: user, admin, or moderator';
