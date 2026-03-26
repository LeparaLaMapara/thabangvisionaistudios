-- 022: Bug reports table
-- Required by: TASK-040
-- Run in Supabase SQL Editor (both prod and dev)

-- ═══ 1. Create bug_reports table ═══
create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  user_email text,
  title text not null,
  description text not null,
  steps_to_reproduce text,
  expected_behaviour text,
  actual_behaviour text,
  page_url text,
  device_info text,
  browser_info text,
  severity text default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ═══ 2. Row-level security ═══
alter table bug_reports enable row level security;

-- Anyone can submit a bug report (even unauthenticated, handled at API level)
create policy "Authenticated users can insert bug reports"
  on bug_reports for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can view their own reports
create policy "Users can view own bug reports"
  on bug_reports for select
  to authenticated
  using (auth.uid() = user_id);

-- Service role (admin API) can do everything
-- (Admin routes use createAdminClient which bypasses RLS)

-- ═══ 3. Indexes ═══
create index if not exists idx_bug_reports_user_id on bug_reports(user_id);
create index if not exists idx_bug_reports_status on bug_reports(status);
create index if not exists idx_bug_reports_severity on bug_reports(severity);
create index if not exists idx_bug_reports_created_at on bug_reports(created_at desc);
