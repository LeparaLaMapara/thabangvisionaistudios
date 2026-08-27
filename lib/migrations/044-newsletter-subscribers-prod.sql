-- 044 — Create newsletter_subscribers in production
--
-- The table was defined in 017 and exists in development, but was never
-- applied to production. app/api/newsletter/route.ts catches the resulting
-- "relation does not exist" error, logs it, and returns { success: true } — so
-- the visitor sees a confirmation and the address is thrown away.
--
-- Every newsletter signup on the live site has been silently discarded.
-- Nothing can be recovered; this only stops the loss going forward.

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  subscribed_at timestamptz default now(),
  unsubscribed_at timestamptz
);

alter table public.newsletter_subscribers enable row level security;

-- Service role only. The signup and unsubscribe routes both use the admin
-- client, and nothing else should read a marketing list.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='newsletter_subscribers'
      and policyname='Service role only'
  ) then
    create policy "Service role only" on public.newsletter_subscribers
      for all using (false);
  end if;
end $$;

create index if not exists idx_newsletter_subscribers_active
  on public.newsletter_subscribers (email)
  where unsubscribed_at is null;
