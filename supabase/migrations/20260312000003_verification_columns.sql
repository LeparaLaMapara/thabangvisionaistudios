-- 003: Add verification columns to profiles table
-- Required by: app/api/verifications/route.ts, lib/supabase/queries/verifications.ts
-- Run in Supabase SQL Editor

-- ─── 1. Add verification columns to profiles ────────────────────────────────

alter table profiles
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_rejected_reason text,
  add column if not exists id_front_path text,
  add column if not exists id_back_path text,
  add column if not exists proof_of_address_path text;

-- ─── 2. Create Supabase Storage bucket for verification documents ───────────

insert into storage.buckets (id, name, public)
values ('verifications', 'verifications', false)
on conflict (id) do nothing;

-- ─── 3. Storage RLS — authenticated users can upload to their own folder ────

create policy "Users can upload own verification docs"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'verifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own verification docs"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'verifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own verification docs"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'verifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read all verification docs (for review)
-- Uses service_role key on server-side, so no explicit policy needed.
-- If you want admin users to read via client, add a policy checking ADMIN_EMAILS.

-- ─── 4. Index for fast admin queries on verification status ─────────────────

create index if not exists idx_profiles_verification_status
  on profiles (verification_status)
  where verification_status != 'unverified';
