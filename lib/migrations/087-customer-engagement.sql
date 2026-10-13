-- 087: customer engagement (welcome, "finish your signup" nudges, tailored
-- suggestions, web push).
--
-- Needs 070 (notification_outbox, claim_outbox). One transaction, safe to run
-- twice.
--
-- WHAT THIS DOES
--   1. profiles.email_lifecycle_opt_out (+ _at): set by the signed unsubscribe
--      link in every lifecycle email. Not client-writable: 067 grants UPDATE
--      on an explicit column list and a new column is not on it. Only the
--      server (service role) sets it.
--   2. notification_outbox accepts channel 'push'.
--   3. Engagement rows (kind starting 'engage_') have their own claim,
--      claim_engagement_outbox(). claim_outbox() (the rental pipeline's
--      dispatcher) now leaves them alone, and the engagement claim leaves
--      rental rows alone, so neither dispatcher delivers the other's messages.
--   4. push_subscriptions: one row per browser that turned on notifications.
--      Owner-only RLS: a person reads, adds and removes only their own.
--   5. A trigger on notifications queues a push copy of each bell item, only
--      for people who have a push subscription. It never blocks the insert.
--
-- ROLLBACK (manual)
--   begin;
--   drop trigger if exists on_notification_queue_push on public.notifications;
--   drop function if exists public.enqueue_push_for_notification();
--   drop function if exists public.claim_engagement_outbox(integer, integer, text[]);
--   drop table if exists public.push_subscriptions;
--   -- re-run the claim_outbox definition from 070 section 8
--   delete from public.notification_outbox where channel = 'push';
--   alter table public.notification_outbox drop constraint notification_outbox_channel_check,
--     add constraint notification_outbox_channel_check check (channel in ('in_app', 'email', 'sms'));
--   alter table public.profiles drop column if exists email_lifecycle_opt_out_at,
--     drop column if exists email_lifecycle_opt_out;
--   commit;

begin;

-- ── 1. Per-person opt-out from lifecycle emails ──────────────────────────────

alter table public.profiles add column if not exists email_lifecycle_opt_out boolean not null default false;
alter table public.profiles add column if not exists email_lifecycle_opt_out_at timestamptz;

-- ── 2. The outbox carries push ───────────────────────────────────────────────

alter table public.notification_outbox drop constraint if exists notification_outbox_channel_check;
alter table public.notification_outbox add constraint notification_outbox_channel_check
  check (channel in ('in_app', 'email', 'sms', 'push'));

-- Caps and the admin log read a person's engagement rows by time.
create index if not exists idx_notification_outbox_engage_user
  on public.notification_outbox (user_id, created_at)
  where left(kind, 7) = 'engage_';

-- ── 3. Two dispatchers, two claims ───────────────────────────────────────────

create or replace function public.claim_outbox(p_limit integer, p_max_attempts integer default 5)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notification_outbox set status = 'dead'
   where status in ('failed', 'sending') and attempts >= p_max_attempts
     and left(kind, 7) <> 'engage_';
  return query
  update public.notification_outbox o
     set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
   where o.id in (
     select id from public.notification_outbox
      where (status in ('pending', 'failed') or (status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '10 minutes'))
        and coalesce(send_after, now()) <= now()
        and left(kind, 7) <> 'engage_'
      order by created_at
      limit p_limit
      for update skip locked)
  returning o.*;
end;
$$;

-- p_channels: only these channels (null = all). The push kick after a page
-- poll claims push only, so it never drafts emails on a visitor's request.
drop function if exists public.claim_engagement_outbox(integer, integer);
create or replace function public.claim_engagement_outbox(p_limit integer, p_max_attempts integer default 3, p_channels text[] default null)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notification_outbox set status = 'dead'
   where status in ('failed', 'sending') and attempts >= p_max_attempts
     and left(kind, 7) = 'engage_';
  return query
  update public.notification_outbox o
     set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
   where o.id in (
     select id from public.notification_outbox
      where (status in ('pending', 'failed') or (status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '10 minutes'))
        and coalesce(send_after, now()) <= now()
        and left(kind, 7) = 'engage_'
        and (p_channels is null or channel = any (p_channels))
      order by created_at
      limit greatest(1, least(coalesce(p_limit, 50), 500))
      for update skip locked)
  returning o.*;
end;
$$;

revoke all on function public.claim_outbox(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer, integer) to service_role;
revoke all on function public.claim_engagement_outbox(integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_engagement_outbox(integer, integer, text[]) to service_role;

-- ── 4. Push subscriptions ────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

drop policy if exists "Own push subscriptions: read" on public.push_subscriptions;
create policy "Own push subscriptions: read" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Own push subscriptions: add" on public.push_subscriptions;
create policy "Own push subscriptions: add" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Own push subscriptions: remove" on public.push_subscriptions;
create policy "Own push subscriptions: remove" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- ── 5. Bell items also go out as push ────────────────────────────────────────
-- Only the notification id is queued; the dispatcher reads the row when it
-- sends (and skips it when it was already read).

create or replace function public.enqueue_push_for_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    insert into public.notification_outbox (dedupe_key, kind, channel, user_id, data)
    values ('engage_push:notification:' || new.id, 'engage_push', 'push', new.user_id::text,
            jsonb_build_object('notificationId', new.id))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
exception when others then
  -- A push is a nicety: never let it stop the notification itself.
  raise warning 'enqueue_push_for_notification failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_push_for_notification() from public, anon, authenticated;

drop trigger if exists on_notification_queue_push on public.notifications;
create trigger on_notification_queue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push_for_notification();

commit;

notify pgrst, 'reload schema';
