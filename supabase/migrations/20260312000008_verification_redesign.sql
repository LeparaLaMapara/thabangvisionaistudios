-- 008: Verification Redesign — Selfie + ID with EXIF Fraud Detection
-- Required by: TASK-038
-- Run in Supabase SQL Editor

-- ═══ 0. Drop legacy proof_of_address column ═══
alter table profiles drop column if exists proof_of_address_path;

-- ═══ 1. Add new verification columns ═══

-- Selfie with ID path
alter table profiles add column if not exists
  selfie_with_id_path text;

-- EXIF metadata from all verification photos
alter table profiles add column if not exists
  verification_metadata jsonb default null;

-- AI screening results (V5 — populated by Claude Vision later)
alter table profiles add column if not exists
  verification_ai_check jsonb default null;

-- Fraud flags detected by automated checks
alter table profiles add column if not exists
  verification_fraud_flags jsonb default '[]';

-- Hash of ID document for duplicate detection
alter table profiles add column if not exists
  id_document_hash text;

-- IP and device info from submission
alter table profiles add column if not exists
  verification_ip text;

alter table profiles add column if not exists
  verification_user_agent text;

-- Number of submission attempts
alter table profiles add column if not exists
  verification_attempts integer default 0;

-- ═══ 2. Index for duplicate hash detection ═══
create index if not exists idx_profiles_id_hash
  on profiles (id_document_hash)
  where id_document_hash is not null;
