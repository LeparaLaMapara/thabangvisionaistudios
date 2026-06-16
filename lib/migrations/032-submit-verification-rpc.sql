-- Migration 032: Add submit_verification_request RPC function
-- Applied: 2026-06-16 via Supabase MCP
--
-- This SECURITY DEFINER function allows the user-session client to submit
-- verification documents without needing the service role key (admin client).
-- The RLS policy on profiles prevents users from changing verification_status
-- directly, so this function bypasses that restriction safely via auth.uid().

CREATE OR REPLACE FUNCTION submit_verification_request(
  p_id_front_path text,
  p_id_back_path text DEFAULT NULL,
  p_selfie_with_id_path text DEFAULT NULL,
  p_verification_metadata jsonb DEFAULT '{}'::jsonb,
  p_verification_fraud_flags jsonb DEFAULT '[]'::jsonb,
  p_id_document_hash text DEFAULT NULL,
  p_verification_ip text DEFAULT 'unknown',
  p_verification_user_agent text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current record;
  v_duplicate record;
  v_flags jsonb := p_verification_fraud_flags;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT verification_status, verification_attempts
  INTO v_current
  FROM profiles WHERE id = v_user_id;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  IF v_current.verification_status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already under review');
  END IF;

  IF v_current.verification_status = 'verified' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already verified');
  END IF;

  IF v_current.verification_attempts >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum attempts reached');
  END IF;

  SELECT id, display_name INTO v_duplicate
  FROM profiles
  WHERE id_document_hash = p_id_document_hash
    AND id != v_user_id
  LIMIT 1;

  IF v_duplicate IS NOT NULL THEN
    v_flags := v_flags || jsonb_build_array(
      jsonb_build_object(
        'severity', 'high',
        'code', 'DUPLICATE_ID',
        'message', 'Same ID document submitted by another account'
      )
    );
  END IF;

  UPDATE profiles SET
    id_front_path = p_id_front_path,
    id_back_path = p_id_back_path,
    selfie_with_id_path = p_selfie_with_id_path,
    verification_metadata = p_verification_metadata,
    verification_ai_check = NULL,
    verification_fraud_flags = v_flags,
    id_document_hash = p_id_document_hash,
    verification_ip = p_verification_ip,
    verification_user_agent = p_verification_user_agent,
    verification_attempts = v_current.verification_attempts + 1,
    verification_status = 'pending',
    verification_submitted_at = now(),
    verification_reviewed_at = NULL,
    verification_rejected_reason = NULL
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'flags_detected', jsonb_array_length(v_flags)
  );
END;
$$;
