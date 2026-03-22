-- 007: Crew & Services System
-- Required by: TASK-037
-- Run in Supabase SQL Editor

-- ═══ 1. Add crew columns to profiles ═══

alter table profiles add column if not exists
  available_for_hire boolean default false;

alter table profiles add column if not exists
  hourly_rate integer;

alter table profiles add column if not exists
  specializations text[] default '{}';

alter table profiles add column if not exists
  crew_slug text unique;

alter table profiles add column if not exists
  crew_bio text;

alter table profiles add column if not exists
  years_experience integer;

alter table profiles add column if not exists
  crew_featured boolean default false;

-- Index for crew queries
create index if not exists idx_profiles_crew
  on profiles (available_for_hire, verification_status)
  where available_for_hire = true and verification_status = 'verified';

-- ═══ 2. Add crew_ids to smart_productions (for tagging crew in portfolio) ═══

alter table smart_productions add column if not exists
  crew_ids uuid[] default '{}';

create index if not exists idx_productions_crew_ids
  on smart_productions using gin (crew_ids);

-- ═══ 3. Crew requests table ═══

create table if not exists crew_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references profiles(id) not null,
  client_name text not null,
  client_email text not null,
  client_phone text,
  project_type text not null,
  preferred_dates text,
  description text not null,
  budget_range text,
  location text,
  duration text,
  status text default 'pending'
    check (status in ('pending', 'contacted', 'confirmed', 'declined', 'completed', 'cancelled')),
  admin_notes text,
  commission_rate integer default 15,
  total_amount integer,
  commission_amount integer,
  booked_via text default 'ubunye',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table crew_requests enable row level security;

create policy "Admins can manage crew requests" on crew_requests
  for all using (true);

create policy "Creators can view own requests" on crew_requests
  for select using (auth.uid() = creator_id);

create policy "Anyone can submit crew request" on crew_requests
  for insert with check (true);

-- ═══ 4. Smart crews (preset teams) ═══

create table if not exists smart_crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  category text,
  package_rate integer,
  package_includes text,
  is_published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table smart_crews enable row level security;

create policy "Public can view published crews" on smart_crews
  for select using (is_published = true);

create policy "Admins can manage crews" on smart_crews
  for all using (true);

-- ═══ 5. Smart crew members junction ═══

create table if not exists smart_crew_members (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references smart_crews(id) on delete cascade not null,
  profile_id uuid references profiles(id) not null,
  role_in_crew text not null,
  unique (crew_id, profile_id)
);

alter table smart_crew_members enable row level security;

create policy "Public can view crew members" on smart_crew_members
  for select using (true);

create policy "Admins can manage members" on smart_crew_members
  for all using (true);

-- ═══ 6. Crew reviews ═══

create table if not exists crew_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references crew_requests(id) not null,
  creator_id uuid references profiles(id) not null,
  reviewer_name text not null,
  reviewer_email text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  review_text text,
  is_published boolean default false,
  created_at timestamptz default now()
);

alter table crew_reviews enable row level security;

create policy "Public can view published reviews" on crew_reviews
  for select using (is_published = true);

create policy "Anyone can insert review" on crew_reviews
  for insert with check (true);

create policy "Admins can manage reviews" on crew_reviews
  for all using (true);
