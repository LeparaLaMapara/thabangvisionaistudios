-- 088: fixes from the security tests of 2026-10-13
-- (docs/security/2026-10-13-security-test.md).
--
-- Needs 060 (notify_signup), 063 (phone_codes), 085 (disputes index) and
-- 087 (push_subscriptions). One transaction, safe to run twice.
--
-- WHAT THIS DOES
--   1. disputes: signed-in users may no longer insert directly. Any user
--      could open a dispute on someone else's booking through the REST API
--      (the policy only checked filed_by), which blocked the real parties
--      (one live dispute per booking, 085) and held the creator's payout.
--      /api/disputes checks the person is a party and writes with the
--      service role, so nothing in the site used the client insert.
--   2. push_subscriptions: only the server adds them (the route checks the
--      push service and the cap); endpoints must be on a real push service
--      (the server POSTs to them: any other host is request forgery); at
--      most 10 per person, the oldest removed.
--   3. phone_codes: phone_code_store() and phone_code_try() count sends and
--      guesses in one atomic statement each. The routes read, compared and
--      then wrote, so parallel requests all saw the old count.
--   4. Review text and dispute text have a length limit.
--   5. The signup webhook is called again when an account's email is
--      confirmed: the site now drafts the welcome and tells the owner only
--      for confirmed accounts (anyone can create unconfirmed ones).
--   6. anon loses its stray SELECT grants on banking_details and
--      subscriptions (RLS already returned nothing).
--
-- NOT HERE: revoking pg_net's net.http_* from anon/authenticated. The
-- functions belong to supabase_admin and run as PUBLIC by default; the
-- postgres role cannot change that (tried on dev 2026-10-13: no effect).
-- PostgREST does not expose the net schema, so it is not reachable.
--
-- ROLLBACK (manual)
--   begin;
--   grant insert on public.disputes to authenticated;
--   create policy "Users can file disputes" on public.disputes for insert with check ((select auth.uid()) = filed_by);
--   grant insert (user_id, endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
--   create policy "Own push subscriptions: add" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
--   alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_push_service;
--   drop trigger if exists push_subscriptions_cap on public.push_subscriptions;
--   drop function if exists public.push_subscriptions_cap();
--   drop function if exists public.phone_code_store(uuid, text, text, integer, integer);
--   drop function if exists public.phone_code_try(uuid, integer);
--   alter table public.reviews drop constraint if exists reviews_comment_length;
--   alter table public.bookings drop constraint if exists bookings_client_review_length;
--   alter table public.disputes drop constraint if exists disputes_text_length;
--   drop trigger if exists on_auth_user_confirmed_notify on auth.users;
--   commit;

begin;

-- ── 1. Disputes are filed through the site only ─────────────────────────────

revoke insert, update, delete on public.disputes from anon, authenticated;
drop policy if exists "Users can file disputes" on public.disputes;

-- ── 2. Push subscriptions ───────────────────────────────────────────────────

revoke insert on public.push_subscriptions from authenticated;
drop policy if exists "Own push subscriptions: add" on public.push_subscriptions;

-- Rows saved before this check (none on dev or prod, 2026-10-13) that are not
-- on a push service go: the server would refuse to send to them anyway.
delete from public.push_subscriptions
 where endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/';

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_push_service;
-- Same list as lib/push/subscriptions.ts isPushHost(). No port, no user.
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_push_service check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
  and endpoint !~ '[[:space:][:cntrl:]\\]'
);

create or replace function public.push_subscriptions_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- At most 10 browsers per person (lib/push/subscriptions.ts
  -- MAX_SUBSCRIPTIONS_PER_USER); the oldest go first.
  delete from public.push_subscriptions s
   where s.user_id = new.user_id
     and s.id in (
       select id from public.push_subscriptions
        where user_id = new.user_id
        order by created_at desc, id desc
        offset 10
     );
  return null;
end;
$$;
revoke all on function public.push_subscriptions_cap() from public, anon, authenticated;

drop trigger if exists push_subscriptions_cap on public.push_subscriptions;
create trigger push_subscriptions_cap
  after insert or update of user_id on public.push_subscriptions
  for each row execute function public.push_subscriptions_cap();

-- ── 3. Phone codes: atomic counters ─────────────────────────────────────────

-- Saves a new code for the person and counts the send, in one statement.
-- Returns false (and saves nothing) when they already had p_max_per_hour
-- codes in the current hour.
create or replace function public.phone_code_store(
  p_user          uuid,
  p_phone         text,
  p_code_hash     text,
  p_ttl_minutes   integer,
  p_max_per_hour  integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.phone_codes as pc (user_id, phone, code_hash, expires_at, attempts, sent_count, created_at)
  values (p_user, p_phone, p_code_hash, now() + make_interval(mins => p_ttl_minutes), 0, 1, now())
  on conflict (user_id) do update
     set phone      = excluded.phone,
         code_hash  = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempts   = 0,
         sent_count = case when pc.created_at > now() - interval '1 hour' then pc.sent_count + 1 else 1 end,
         created_at = case when pc.created_at > now() - interval '1 hour' then pc.created_at else now() end
   where pc.created_at <= now() - interval '1 hour' or pc.sent_count < p_max_per_hour
  returning pc.sent_count into v_count;
  return v_count is not null;
end;
$$;

-- Counts one guess and returns the code to compare, in one statement.
-- outcome: 'ok' (compare code_hash), 'expired' (no live code) or 'too_many'.
create or replace function public.phone_code_try(p_user uuid, p_max_attempts integer)
returns table (outcome text, phone text, code_hash text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone   text;
  v_hash    text;
  v_expired boolean;
begin
  update public.phone_codes pc
     set attempts = pc.attempts + 1
   where pc.user_id = p_user
     and pc.expires_at > now()
     and pc.attempts < p_max_attempts
  returning pc.phone, pc.code_hash into v_phone, v_hash;
  if v_hash is not null then
    return query select 'ok'::text, v_phone, v_hash;
    return;
  end if;

  select pc.expires_at <= now() into v_expired from public.phone_codes pc where pc.user_id = p_user;
  return query select case when v_expired is false then 'too_many' else 'expired' end, null::text, null::text;
end;
$$;

revoke all on function public.phone_code_store(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.phone_code_try(uuid, integer) from public, anon, authenticated;
grant execute on function public.phone_code_store(uuid, text, text, integer, integer) to service_role;
grant execute on function public.phone_code_try(uuid, integer) to service_role;

-- ── 4. Text limits ──────────────────────────────────────────────────────────

-- 2000 characters: lib/supabase/queries/creatorReviews.ts MAX_REVIEW_CHARS and
-- lib/disputes/report.ts REPORT_MAX_CHARS. NOT VALID then VALIDATE, so a
-- longer row already stored stops the file here instead of being cut.
alter table public.reviews drop constraint if exists reviews_comment_length;
alter table public.reviews add constraint reviews_comment_length
  check (comment is null or length(comment) <= 2000) not valid;
alter table public.reviews validate constraint reviews_comment_length;

alter table public.bookings drop constraint if exists bookings_client_review_length;
alter table public.bookings add constraint bookings_client_review_length
  check (client_review is null or length(client_review) <= 2000) not valid;
alter table public.bookings validate constraint bookings_client_review_length;

alter table public.disputes drop constraint if exists disputes_text_length;
alter table public.disputes add constraint disputes_text_length
  check (length(reason) <= 2000 and (evidence_notes is null or length(evidence_notes) <= 2000)) not valid;
alter table public.disputes validate constraint disputes_text_length;

-- ── 5. Signup webhook again on email confirmation ───────────────────────────

drop trigger if exists on_auth_user_confirmed_notify on auth.users;
create trigger on_auth_user_confirmed_notify
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.notify_signup();

-- ── 6. Stray anon grants ────────────────────────────────────────────────────

revoke all on public.banking_details from anon;
revoke all on public.subscriptions from anon;

commit;

notify pgrst, 'reload schema';
