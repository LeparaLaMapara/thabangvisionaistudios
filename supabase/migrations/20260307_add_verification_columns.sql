-- Add verification columns to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS verification_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_rejected_reason text,
  ADD COLUMN IF NOT EXISTS id_front_path text,
  ADD COLUMN IF NOT EXISTS id_back_path text,
  ADD COLUMN IF NOT EXISTS proof_of_address_path text;

-- Index for admin queries on verification status
CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
  ON profiles (verification_status)
  WHERE verification_status != 'unverified';

-- Create Supabase Storage bucket for verifications (private)
-- NOTE: This must be created via Supabase Dashboard or the API.
-- Bucket: "verifications" (private, no public access)
-- RLS policies are set via storage.objects policies below.

-- Storage RLS: authenticated users can upload to their own folder
CREATE POLICY "Users can upload verification docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: users can read their own verification docs
CREATE POLICY "Users can read own verification docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: users can update (overwrite) their own verification docs
CREATE POLICY "Users can update own verification docs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
