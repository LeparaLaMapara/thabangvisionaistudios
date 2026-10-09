-- 073 — Creative service fulfilment, acceptance, disputes and payout timing
--        (Phase 2, spec §8.3, 2026-10-09)
--
-- WHY
--   Service bookings (the `bookings` table) had no working decline: the
--   creator's Decline button sent 'cancelled', which creators may not set, so
--   it failed with a 400. Nothing recorded what was agreed (revisions,
--   cancellation terms), a client's approval paid the creator at once with no
--   window to raise a problem, and every payout retry invented a new transfer
--   reference, which could pay a creator twice.
--
-- WHAT
--   1. bookings gains:
--        declined_at, decline_reason          creator declined a paid request
--        revisions_included, revisions_used   the revision allowance and its use
--        revision_policy, cancellation_policy the wording agreed at booking time
--        accepted_by_client_at                the client explicitly approved delivery
--                                             (null when approved automatically)
--        payout_due_at                        earliest time the creator payout may be sent
--        dispute_window_ends_at               end of the window to raise a problem
--        payout_claimed_at, payout_last_error payout bookkeeping for reconciliation
--   2. bookings_status_check allows 'declined' (all existing values kept).
--   3. Completed bookings not yet paid out get payout_due_at / dispute_window_ends_at
--      (completed_at + 72 hours, STUDIO.booking.payoutDelayHours) so the daily
--      job has a due time to read. The code falls back to the same sum.
--   4. service_booking_events: append-only history of every service status
--      change (who, from, to, why). Parties to the booking may read their own;
--      only the server (service role) writes.
--   5. notifications.type gains 'gig_revision_requested'. The existing list is
--      read from the live constraint and extended, so types added by other
--      migrations are kept whatever order they run in.
--
-- SAFETY
--   Additive and re-runnable (IF NOT EXISTS, DROP … IF EXISTS, guarded DO
--   blocks). No existing value changes except the payout_due_at backfill on
--   rows that had none. Apply on the dev project first, then production.
--   Code deployed before this migration keeps working: it detects the missing
--   columns and falls back (lib/supabase/queries/service-bookings.ts).
--
-- TEST
--   lib/migrations/073-service-fulfilment.test.sql (one transaction, ROLLBACK).

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.bookings
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists revisions_included integer,
  add column if not exists revisions_used integer not null default 0,
  add column if not exists revision_policy text,
  add column if not exists cancellation_policy text,
  add column if not exists accepted_by_client_at timestamptz,
  add column if not exists payout_due_at timestamptz,
  add column if not exists dispute_window_ends_at timestamptz,
  add column if not exists payout_claimed_at timestamptz,
  add column if not exists payout_last_error text;

alter table public.bookings drop constraint if exists bookings_revisions_check;
alter table public.bookings
  add constraint bookings_revisions_check
  check (
    revisions_used >= 0
    and (revisions_included is null or revisions_included >= 0)
  );

-- ── 2. Status vocabulary: + 'declined' ───────────────────────────────────────

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status = any (array[
    'pending', 'paid', 'accepted', 'delivered', 'completed',
    'paid_out', 'cancelled', 'disputed', 'pending_reassignment',
    'declined'
  ]));

-- ── 3. Due times for completed bookings still waiting for a payout ───────────

update public.bookings
   set payout_due_at = completed_at + interval '72 hours'
 where status = 'completed'
   and payout_due_at is null
   and completed_at is not null;

update public.bookings
   set dispute_window_ends_at = payout_due_at
 where status = 'completed'
   and dispute_window_ends_at is null
   and payout_due_at is not null;

create index if not exists bookings_payout_due_idx
  on public.bookings (payout_due_at)
  where status = 'completed';

-- ── 4. History ───────────────────────────────────────────────────────────────

create table if not exists public.service_booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event text not null,
  from_status text,
  to_status text,
  actor text not null check (actor in ('client', 'creator', 'admin', 'system')),
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists service_booking_events_booking_idx
  on public.service_booking_events (booking_id, created_at);

-- History is never rewritten.
create or replace function public.service_booking_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'service_booking_events is append-only';
end;
$$;

drop trigger if exists service_booking_events_no_update on public.service_booking_events;
create trigger service_booking_events_no_update
  before update on public.service_booking_events
  for each row execute function public.service_booking_events_append_only();

alter table public.service_booking_events enable row level security;

drop policy if exists "Parties read their service booking history" on public.service_booking_events;
create policy "Parties read their service booking history"
  on public.service_booking_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
       where b.id = service_booking_events.booking_id
         and (b.client_id = auth.uid() or b.creator_id = auth.uid())
    )
  );

-- No INSERT / UPDATE / DELETE policy: user sessions cannot write. The grants
-- are revoked as well, so a policy added by mistake later still cannot write.
revoke insert, update, delete, truncate on public.service_booking_events from anon, authenticated;
revoke all on public.service_booking_events from anon;
grant select on public.service_booking_events to authenticated;

-- ── 5. Notification type: + 'gig_revision_requested' ─────────────────────────

do $$
declare
  def text;
  types text[];
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.conname = 'notifications_type_check';

  if def is null then
    -- No list on this database: nothing to extend.
    return;
  end if;

  -- Postgres prints the list either as ARRAY['a'::text, ...] or as one
  -- array literal '{a,b}'::text[]. Read both.
  if def ~ '''\{[^'']*\}''' then
    types := (substring(def from '''(\{[^'']*\})'''))::text[];
  else
    select coalesce(array_agg(m[1]), '{}') into types
      from regexp_matches(def, '''([^'']+)''', 'g') as m;
  end if;

  if coalesce(array_length(types, 1), 0) = 0 then
    raise exception 'notifications_type_check could not be read; not changed: %', def;
  end if;

  if 'gig_revision_requested' = any (types) then
    return;
  end if;

  types := types || array['gig_revision_requested'];

  alter table public.notifications drop constraint notifications_type_check;
  -- Written back as ARRAY['a', 'b', ...] like the earlier migrations.
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]::text[]))',
    (select string_agg(quote_literal(t), ', ' order by ord) from unnest(types) with ordinality as u(t, ord))
  );
end $$;

commit;

-- ── Rollback (manual; read first) ────────────────────────────────────────────
-- Only before any booking has been declined: a 'declined' row violates the
-- restored status check. Move such rows to 'cancelled' first.
--
--   begin;
--   update public.bookings set status = 'cancelled' where status = 'declined';
--   alter table public.bookings drop constraint if exists bookings_status_check;
--   alter table public.bookings add constraint bookings_status_check check (status = any (array[
--     'pending', 'paid', 'accepted', 'delivered', 'completed',
--     'paid_out', 'cancelled', 'disputed', 'pending_reassignment']));
--   drop table if exists public.service_booking_events;
--   drop function if exists public.service_booking_events_append_only();
--   drop index if exists public.bookings_payout_due_idx;
--   alter table public.bookings drop constraint if exists bookings_revisions_check;
--   alter table public.bookings
--     drop column if exists declined_at, drop column if exists decline_reason,
--     drop column if exists revisions_included, drop column if exists revisions_used,
--     drop column if exists revision_policy, drop column if exists cancellation_policy,
--     drop column if exists accepted_by_client_at, drop column if exists payout_due_at,
--     drop column if exists dispute_window_ends_at, drop column if exists payout_claimed_at,
--     drop column if exists payout_last_error;
--   -- 'gig_revision_requested' may stay in notifications_type_check (harmless).
--   commit;
-- Once creators have been paid under this scheme, keep service_booking_events:
-- it is the record of who approved what and when.
