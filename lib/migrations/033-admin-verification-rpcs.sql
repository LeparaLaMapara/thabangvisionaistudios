-- Migration 033: Admin verification RPCs + is_admin() fallback
-- Applied: 2026-06-17 via Supabase MCP
--
-- 1. Updated is_admin() to also check profiles.role as fallback
--    (matches the 3-level check in requireAdmin())
-- 2. Created admin RPC functions for verification management:
--    - admin_list_verifications() — lists all with emails from auth.users
--    - admin_get_verification(uuid) — single verification with email
--    - admin_approve_verification(uuid) — approves + auto-setup crew slug
--    - admin_reject_verification(uuid, reason) — rejects with reason
-- All use SECURITY DEFINER + is_admin() guard.

-- ─── is_admin() with profiles.role fallback ─────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') = 'admin',
      false
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- ─── admin_list_verifications ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_verifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_to_jsonb(t) ORDER BY t.verification_submitted_at DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT p.id, p.display_name, p.avatar_url, p.bio, p.phone, p.location,
             p.skills, p.social_links, p.is_verified, p.verification_status,
             p.verification_submitted_at, p.verification_reviewed_at,
             p.verification_rejected_reason, p.id_front_path, p.id_back_path,
             p.selfie_with_id_path, p.verification_metadata, p.verification_ai_check,
             p.verification_fraud_flags, p.id_document_hash, p.verification_ip,
             p.verification_user_agent, p.verification_attempts, p.created_at,
             au.email
      FROM profiles p
      JOIN auth.users au ON au.id = p.id
      WHERE p.verification_status != 'unverified'
    ) t
  );
END;
$$;

-- ─── admin_get_verification ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_verification(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT row_to_jsonb(t)
    FROM (
      SELECT p.id, p.display_name, p.avatar_url, p.bio, p.phone, p.location,
             p.skills, p.social_links, p.is_verified, p.verification_status,
             p.verification_submitted_at, p.verification_reviewed_at,
             p.verification_rejected_reason, p.id_front_path, p.id_back_path,
             p.selfie_with_id_path, p.verification_metadata, p.verification_ai_check,
             p.verification_fraud_flags, p.id_document_hash, p.verification_ip,
             p.verification_user_agent, p.verification_attempts, p.created_at,
             au.email
      FROM profiles p
      JOIN auth.users au ON au.id = p.id
      WHERE p.id = p_user_id
    ) t
  );
END;
$$;

-- ─── admin_approve_verification ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_approve_verification(p_user_id uuid, p_crew_slug text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
  v_slug text;
  v_existing int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE profiles SET
    verification_status = 'verified',
    is_verified = true,
    verification_reviewed_at = now()
  WHERE id = p_user_id;

  SELECT display_name INTO v_display_name FROM profiles WHERE id = p_user_id;

  IF v_display_name IS NOT NULL AND v_display_name != '' THEN
    v_slug := coalesce(p_crew_slug, lower(regexp_replace(v_display_name, '[^a-zA-Z0-9]+', '-', 'g')));
    v_slug := trim(both '-' from v_slug);

    SELECT count(*) INTO v_existing
    FROM profiles
    WHERE crew_slug LIKE v_slug || '%' AND id != p_user_id;

    IF v_existing > 0 THEN
      v_slug := v_slug || '-' || (v_existing + 1)::text;
    END IF;

    UPDATE profiles SET
      available_for_hire = true,
      crew_slug = v_slug
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'email', (SELECT email FROM auth.users WHERE id = p_user_id),
    'display_name', v_display_name
  );
END;
$$;

-- ─── admin_reject_verification ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_reject_verification(p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT display_name INTO v_display_name FROM profiles WHERE id = p_user_id;

  UPDATE profiles SET
    verification_status = 'rejected',
    is_verified = false,
    verification_reviewed_at = now(),
    verification_rejected_reason = p_reason
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'email', (SELECT email FROM auth.users WHERE id = p_user_id),
    'display_name', v_display_name
  );
END;
$$;
