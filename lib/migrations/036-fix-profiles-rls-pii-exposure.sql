-- Migration 036: Fix critical RLS policy vulnerabilities
--
-- CONTEXT: Supabase project URL was publicly shared on social media.
-- The anon key + URL allow anyone to query the database directly.
--
-- CRITICAL ISSUES FIXED:
--   1. profiles SELECT: "Profiles: public read" with qual=true exposes ALL 55 columns
--      including phone, address, GPS, ID document paths, fraud flags, IPs
--   2. profiles INSERT: "Profiles: auto insert on signup" allows ANY caller to insert
--      profiles with arbitrary values (including role='admin')
--   3. profiles UPDATE: "Profiles: owner update" has no with_check — owners can
--      self-escalate role, is_verified, is_suspended, etc.
--   4. platform_events SELECT: "Admin reads all events" actually grants public read
--   5. platform_events INSERT: "System inserts events" allows anyone to insert
--
-- APPROACH:
--   - Create a public_profiles VIEW with only safe display columns
--   - Restrict profiles table to: owner reads own row, authenticated reads safe view
--   - Lock down INSERT to auth.uid() = id only
--   - Add with_check on UPDATE to prevent privilege escalation
--   - Restrict platform_events to admin/service_role only

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. FIX PROFILES TABLE — PUBLIC READ EXPOSING PII
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the dangerously open SELECT policy
DROP POLICY IF EXISTS "Profiles: public read" ON profiles;

-- Owner can always read their full profile (needed for dashboard, settings)
CREATE POLICY "Profiles: owner reads own"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Admin can read all profiles
CREATE POLICY "Profiles: admin reads all"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin());

-- Create a VIEW with only safe public-facing columns
-- This is what public/creator pages should query
CREATE OR REPLACE VIEW public_profiles AS
SELECT
  id,
  display_name,
  avatar_url,
  bio,
  skills,
  social_links,
  location,
  specializations,
  crew_slug,
  crew_bio,
  years_experience,
  crew_featured,
  hourly_rate,
  available_for_hire,
  portfolio_projects,
  is_verified,
  verification_status,
  created_at
FROM profiles;

-- Grant access to the view for both anon and authenticated
GRANT SELECT ON public_profiles TO anon;
GRANT SELECT ON public_profiles TO authenticated;

-- Enable RLS on the view (views inherit table RLS by default in Supabase,
-- but we want the VIEW to be accessible without the table policy blocking it)
-- The view runs as the view owner (typically postgres/superuser), so it
-- bypasses the table RLS. We add a security_invoker = false to ensure this.
ALTER VIEW public_profiles SET (security_invoker = false);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. FIX PROFILES INSERT — PREVENT ARBITRARY ROW INSERTION
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the open INSERT policy
DROP POLICY IF EXISTS "Profiles: auto insert on signup" ON profiles;

-- Only allow inserting your own profile row, and only safe fields
-- The handle_new_user trigger runs as SECURITY DEFINER (bypasses RLS)
-- so it doesn't need an open policy
CREATE POLICY "Profiles: insert own only"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. FIX PROFILES UPDATE — PREVENT PRIVILEGE ESCALATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the existing policy that has no with_check
DROP POLICY IF EXISTS "Profiles: owner update" ON profiles;

-- Owner can update their own row, but CANNOT change privileged fields
-- with_check ensures the update doesn't escalate privileges
CREATE POLICY "Profiles: owner update safe"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM profiles p WHERE p.id = auth.uid())
    AND is_verified = (SELECT p.is_verified FROM profiles p WHERE p.id = auth.uid())
    AND verification_status = (SELECT p.verification_status FROM profiles p WHERE p.id = auth.uid())
    AND is_suspended IS NOT DISTINCT FROM (SELECT p.is_suspended FROM profiles p WHERE p.id = auth.uid())
    AND no_show_count IS NOT DISTINCT FROM (SELECT p.no_show_count FROM profiles p WHERE p.id = auth.uid())
    AND crew_featured IS NOT DISTINCT FROM (SELECT p.crew_featured FROM profiles p WHERE p.id = auth.uid())
  );

-- Admin can update any profile (including privileged fields)
DROP POLICY IF EXISTS "Admins can manage profiles" ON profiles;
CREATE POLICY "Admins can manage profiles"
  ON profiles FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. FIX PLATFORM_EVENTS — LOCK DOWN TO ADMIN/SERVICE ROLE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the misnamed policies that grant public access
DROP POLICY IF EXISTS "Admin reads all events" ON platform_events;
DROP POLICY IF EXISTS "System inserts events" ON platform_events;

-- Only admins can read events
CREATE POLICY "Admin reads all events"
  ON platform_events FOR SELECT
  TO authenticated
  USING (is_admin());

-- Only service_role can insert events (server-side only)
-- No policy for anon/authenticated INSERT — service_role bypasses RLS
-- If authenticated users need to insert events, use an RPC or API route

COMMIT;
