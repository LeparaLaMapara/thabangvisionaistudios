-- 009: Split display_name into first/last name, add structured address
-- Required by: TASK-039
-- Run in Supabase SQL Editor

-- ═══ 1. Add name fields ═══
alter table profiles add column if not exists
  first_name text;

alter table profiles add column if not exists
  last_name text;

-- ═══ 2. Add structured address fields ═══
alter table profiles add column if not exists
  street_address text;

alter table profiles add column if not exists
  city text;

alter table profiles add column if not exists
  province text;

alter table profiles add column if not exists
  postal_code text;

alter table profiles add column if not exists
  country text default 'South Africa';

-- Latitude/longitude for proximity search (crew hiring)
alter table profiles add column if not exists
  address_lat double precision;

alter table profiles add column if not exists
  address_lng double precision;

-- Google Place ID for deduplication
alter table profiles add column if not exists
  address_place_id text;

-- ═══ 3. Track profile completeness ═══
alter table profiles add column if not exists
  onboarding_completed_at timestamptz;

-- ═══ 4. Index for geo queries (crew search by proximity) ═══
create index if not exists idx_profiles_location
  on profiles (address_lat, address_lng)
  where address_lat is not null and address_lng is not null;
