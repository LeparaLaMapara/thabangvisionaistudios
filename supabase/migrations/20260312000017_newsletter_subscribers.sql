-- 017: Newsletter subscribers table
-- Run in Supabase SQL Editor

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  subscribed_at timestamptz default now(),
  unsubscribed_at timestamptz
);

alter table newsletter_subscribers enable row level security;

-- Only service role can read/write (no public access)
create policy "Service role only" on newsletter_subscribers
  for all using (false);
