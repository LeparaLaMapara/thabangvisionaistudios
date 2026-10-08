-- 070 — Gear hire pipeline (Phase 1, 2026-10-08)
--
-- WHY
--   Phase 0 left the gear-hire money path with these gaps (all verified in code):
--     * Availability was read-then-write. Two checkouts could both see the last
--       unit free and both reserve it.
--     * Disputed, inspected and overdue gear did not block new bookings past
--       its original dates.
--     * The payment webhook confirmed a checkout group without checking the
--       current status, so a payment could revive bookings already released.
--       A late charge.failed could cancel a confirmed booking.
--     * No webhook inbox, no refund records, no owner payouts for gear, and no
--       ledger. Deposits were indistinguishable from revenue.
--
-- WHAT
--   1. equipment_bookings: hold expiry, cancel reason, money in integer cents,
--      ownership snapshot, inspection outcome, return evidence.
--   2. rental_blocks: maintenance / repair / lost units.
--   3. rental_units_blocked(): one definition of "taken", including open-ended
--      blocks for gear not yet back.
--   4. rental_payment_intents: what the server expects to be paid, per checkout.
--   5. reserve_rental_order(): locks the listings, re-checks stock, inserts every
--      line and the intent in ONE transaction. All lines or none.
--   6. payment_events: durable webhook inbox, unique per provider event.
--   7. ledger_journals / ledger_lines: append-only, balanced double entry.
--   8. notification_outbox: notifications written in the same transaction as the
--      change they report.
--   9. refund_obligations: one per business reason. Their sum can never exceed
--      the charge.
--  10. owner_payouts: one per booking, with a stable transfer reference.
--  11. booking_status_history, rental_escalations.
--  12. RPCs: confirm_rental_payment, record_unallocated_payment,
--      record_failed_payment_attempt, transition_rental_booking,
--      refund_transition, payout_transition, expire_rental_holds, and claim
--      helpers for the workers.
--  13. notifications.type gains the rental_* kinds.
--
-- SAFETY
--   Additive. Re-runnable (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS).
--   Existing rows keep their values. Pending rows get a hold expiry worked out
--   from the rules the code applied before.
--   Every new function is SECURITY DEFINER with a pinned search_path and can be
--   executed by service_role only. Clients can read only their own intents,
--   refunds and payouts. Every write goes through the server.
--
-- APPLY: DEV first, then run 070-gear-pipeline.test.sql and
--        scripts/db/070-concurrency.sh. PROD only after founder approval.
--        Recommended order: 070 first, then the Phase 1 code. Not required:
--        the code falls back to the earlier (unlocked) paths while these
--        functions are missing, so either order is safe, but the locking and
--        ledger only take effect once 070 is applied.

begin;

-- ── 1. equipment_bookings ────────────────────────────────────────────────────

alter table public.equipment_bookings
  add column if not exists hold_expires_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists hire_cents integer,
  add column if not exists deposit_cents integer,
  add column if not exists owner_share_cents integer,
  add column if not exists platform_share_cents integer,
  add column if not exists unit_replacement_value_cents bigint,
  add column if not exists ownership text,
  add column if not exists owner_id uuid,
  add column if not exists inspection_outcome text,
  add column if not exists return_evidence jsonb,
  add column if not exists completed_at timestamptz,
  add column if not exists requires_manual_approval boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_bookings_cancel_reason_check') then
    alter table public.equipment_bookings add constraint equipment_bookings_cancel_reason_check
      check (cancel_reason is null or cancel_reason in ('hold_expired', 'customer', 'staff', 'payment_failed', 'identity_failed', 'unavailable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_bookings_cents_check') then
    alter table public.equipment_bookings add constraint equipment_bookings_cents_check check (
      (hire_cents is null or hire_cents >= 0) and (deposit_cents is null or deposit_cents >= 0)
      and (owner_share_cents is null or owner_share_cents >= 0) and (platform_share_cents is null or platform_share_cents >= 0)
      and (unit_replacement_value_cents is null or unit_replacement_value_cents >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_bookings_ownership_check') then
    alter table public.equipment_bookings add constraint equipment_bookings_ownership_check
      check (ownership is null or ownership in ('studio', 'community'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_bookings_inspection_outcome_check') then
    alter table public.equipment_bookings add constraint equipment_bookings_inspection_outcome_check
      check (inspection_outcome is null or inspection_outcome in ('clean', 'damage', 'missing_parts', 'late', 'not_returned'));
  end if;
end $$;

comment on column public.equipment_bookings.hold_expires_at is
  'Until when an unpaid pending booking holds its stock. After it, the stock is free even before the row is marked cancelled.';
comment on column public.equipment_bookings.cancel_reason is
  'Why a booking was cancelled. Only hold_expired bookings can be reinstated by a late payment.';

-- Backfill holds for rows that are pending now, using the rules the code applied:
-- cash holds until the hire day ends; EFT holds 48h; online 30 minutes.
update public.equipment_bookings
   set hold_expires_at = case
         when payment_method = 'cash' then (start_date::timestamp + interval '1 day') at time zone 'Africa/Johannesburg'
         when payment_method = 'eft' then created_at + interval '48 hours'
         else created_at + interval '30 minutes'
       end
 where status = 'pending' and hold_expires_at is null;

create index if not exists idx_equipment_bookings_group_status
  on public.equipment_bookings (checkout_group_id, status);
create index if not exists idx_equipment_bookings_rental_open
  on public.equipment_bookings (rental_id, start_date, end_date)
  where status in ('pending', 'confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'disputed');

-- ── 2. rental_blocks ─────────────────────────────────────────────────────────

create table if not exists public.rental_blocks (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.smart_rentals(id) on delete cascade,
  units integer not null default 1 check (units >= 1),
  starts_on date not null,
  ends_on date,
  reason text not null check (reason in ('maintenance', 'inspection', 'repair', 'lost', 'other')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists idx_rental_blocks_open on public.rental_blocks (rental_id) where lifted_at is null;
comment on table public.rental_blocks is 'Units taken off sale for maintenance, repair or loss. ends_on null = until lifted.';

-- ── 3. One definition of "taken" ─────────────────────────────────────────────
-- Dates are inclusive: gear is due back by the end of its end date, so that
-- day is not sold to someone else. Gear that is not back yet (overdue, being
-- inspected, disputed, or active past its end date) blocks open-endedly
-- until a person records it back.

create or replace function public.rental_units_blocked(
  p_rental uuid,
  p_start date,
  p_end date,
  p_exclude_group uuid default null
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(b.quantity)::int
      from public.equipment_bookings b
     where b.rental_id = p_rental
       and (p_exclude_group is null or b.checkout_group_id is distinct from p_exclude_group)
       and (
         b.status in ('confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'disputed')
         or (b.status = 'pending' and (
               b.payfast_payment_id is not null
               or coalesce(b.hold_expires_at, b.created_at + interval '48 hours') > now()))
       )
       and b.start_date <= p_end
       and (case
              when b.status in ('overdue', 'return_pending', 'return_reviewed', 'disputed') then 'infinity'::date
              when b.status = 'active' and b.end_date < current_date then 'infinity'::date
              else b.end_date
            end) >= p_start
  ), 0)
  + coalesce((
    select sum(k.units)::int
      from public.rental_blocks k
     where k.rental_id = p_rental
       and k.lifted_at is null
       and k.starts_on <= p_end
       and coalesce(k.ends_on, 'infinity'::date) >= p_start
  ), 0);
$$;

-- ── 4. Payment intents ───────────────────────────────────────────────────────

create table if not exists public.rental_payment_intents (
  id uuid primary key default gen_random_uuid(),
  checkout_group_id uuid not null unique,
  reference text not null unique,
  provider text not null,
  user_id uuid not null references public.profiles(id) on delete restrict,
  state text not null default 'initiated'
    check (state in ('initiated', 'paid', 'failed', 'expired', 'mismatch', 'refund_due', 'refunded')),
  expected_amount_cents integer not null check (expected_amount_cents >= 0),
  hire_cents integer not null check (hire_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  delivery_cents integer not null default 0 check (delivery_cents >= 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  provider_transaction_id text unique,
  hold_expires_at timestamptz not null,
  paid_at timestamptz,
  failed_attempts integer not null default 0,
  mismatch_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hire_cents + deposit_cents + delivery_cents = expected_amount_cents)
);
comment on table public.rental_payment_intents is
  'What the server expects to be paid for one gear checkout. Only a verified provider event or server-side verification moves it to paid.';

-- ── 5. Atomic reservation ────────────────────────────────────────────────────

create or replace function public.reserve_rental_order(
  p_rows jsonb,
  p_intent jsonb,
  p_hold_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_rec public.equipment_bookings;
  v_ids uuid[] := '{}';
  v_group uuid;
  v_user uuid;
  v_hold timestamptz := now() + make_interval(mins => greatest(1, p_hold_minutes));
  v_stock integer;
  v_taken integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'reserve_rental_order: no lines' using errcode = '22023';
  end if;

  v_group := (p_rows -> 0 ->> 'checkout_group_id')::uuid;
  v_user := (p_rows -> 0 ->> 'user_id')::uuid;
  if v_group is null or v_user is null then
    raise exception 'reserve_rental_order: lines need checkout_group_id and user_id' using errcode = '22023';
  end if;

  -- Lock every listing in this order, in id order. Two carts that share a
  -- listing queue behind each other here instead of both seeing it free.
  perform 1
     from public.smart_rentals r
    where r.id in (select distinct (x ->> 'rental_id')::uuid from jsonb_array_elements(p_rows) x)
    order by r.id
      for update;

  -- A repeated request for the same order (same idempotency key → same order
  -- id) is refused, not reserved twice (T06). Checked after the lock, so two
  -- simultaneous copies of the same request cannot both pass.
  if exists (select 1 from public.equipment_bookings where checkout_group_id = v_group) then
    raise exception 'duplicate_order:%', v_group using errcode = '23505';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_rec := jsonb_populate_record(null::public.equipment_bookings, v_row);
    if v_rec.checkout_group_id is distinct from v_group or v_rec.user_id is distinct from v_user then
      raise exception 'reserve_rental_order: every line must belong to the same order and customer' using errcode = '22023';
    end if;
    v_rec.id := coalesce(v_rec.id, gen_random_uuid());
    v_rec.status := 'pending';
    v_rec.created_at := now();
    v_rec.updated_at := now();
    v_rec.hold_expires_at := v_hold;
    v_rec.quantity := coalesce(v_rec.quantity, 1);
    v_rec.currency := coalesce(v_rec.currency, 'ZAR');
    v_rec.damage_fee := coalesce(v_rec.damage_fee, 0);
    v_rec.requires_manual_approval := coalesce(v_rec.requires_manual_approval, false);
    v_rec.cancelled_at := null;
    v_rec.cancel_reason := null;
    v_rec.payfast_payment_id := null;

    select coalesce(r.quantity, 1) into v_stock
      from public.smart_rentals r
     where r.id = v_rec.rental_id and r.deleted_at is null and not coalesce(r.is_archived, false) and coalesce(r.is_available, true);
    if v_stock is null then
      raise exception 'listing_unavailable:%', v_rec.rental_id using errcode = 'P0002';
    end if;

    v_taken := public.rental_units_blocked(v_rec.rental_id, v_rec.start_date, v_rec.end_date, null);
    if v_taken + v_rec.quantity > v_stock then
      raise exception 'insufficient_stock:%', v_rec.rental_id
        using errcode = 'P0001', detail = format('stock=%s taken=%s requested=%s', v_stock, v_taken, v_rec.quantity);
    end if;

    insert into public.equipment_bookings select v_rec.*;
    v_ids := v_ids || v_rec.id;
  end loop;

  if p_intent is not null then
    insert into public.rental_payment_intents (
      checkout_group_id, reference, provider, user_id, expected_amount_cents,
      hire_cents, deposit_cents, delivery_cents, hold_expires_at
    ) values (
      v_group,
      p_intent ->> 'reference',
      p_intent ->> 'provider',
      v_user,
      (p_intent ->> 'expected_amount_cents')::int,
      (p_intent ->> 'hire_cents')::int,
      (p_intent ->> 'deposit_cents')::int,
      coalesce((p_intent ->> 'delivery_cents')::int, 0),
      v_hold
    );
  end if;

  return jsonb_build_object('booking_ids', to_jsonb(v_ids), 'hold_expires_at', v_hold);
end;
$$;

-- ── 6. Webhook inbox ─────────────────────────────────────────────────────────

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text,
  dedupe_key text not null unique,
  event_type text not null,
  provider_reference text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'dead', 'ignored')),
  retry_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  outcome text
);
create index if not exists idx_payment_events_todo on public.payment_events (next_attempt_at)
  where processing_status in ('received', 'failed', 'processing');
comment on table public.payment_events is
  'Durable webhook inbox. A provider event is acknowledged only after it is stored here. payload keeps the minimum needed (no card or bank data).';

create or replace function public.claim_payment_events(p_limit integer, p_max_retries integer default 8)
returns setof public.payment_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Give up on events that keep failing: a person looks at the dead letters.
  update public.payment_events
     set processing_status = 'dead'
   where processing_status in ('failed', 'processing') and retry_count >= p_max_retries;

  return query
  update public.payment_events e
     set processing_status = 'processing',
         retry_count = e.retry_count + 1,
         -- If this worker dies, the event becomes claimable again after 10 minutes.
         next_attempt_at = now() + interval '10 minutes'
   where e.id in (
     select id from public.payment_events
      where processing_status in ('received', 'failed', 'processing')
        and next_attempt_at <= now()
      order by received_at
      limit p_limit
      for update skip locked)
  returning e.*;
end;
$$;

-- ── 7. Ledger ────────────────────────────────────────────────────────────────

create table if not exists public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  kind text not null,
  booking_group_id uuid,
  memo text,
  created_at timestamptz not null default now(),
  created_by text not null default current_user
);

create table if not exists public.ledger_lines (
  id bigserial primary key,
  journal_id uuid not null references public.ledger_journals(id),
  account text not null check (account in (
    'cash_at_provider', 'unearned_hire', 'customer_deposits', 'refunds_payable', 'owner_payable',
    'unallocated_receipts', 'rental_revenue', 'platform_commission', 'delivery_income', 'damage_income',
    'late_fee_income', 'cancellation_income', 'provider_fees', 'chargebacks')),
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  check ((debit_cents = 0) <> (credit_cents = 0))
);
create index if not exists idx_ledger_lines_journal on public.ledger_lines (journal_id);
create index if not exists idx_ledger_journals_group on public.ledger_journals (booking_group_id);

create or replace function public.ledger_refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception 'the ledger is append-only; post a reversing journal instead' using errcode = '42501';
end;
$$;
drop trigger if exists ledger_journals_append_only on public.ledger_journals;
create trigger ledger_journals_append_only before update or delete on public.ledger_journals
  for each row execute function public.ledger_refuse_change();
drop trigger if exists ledger_lines_append_only on public.ledger_lines;
create trigger ledger_lines_append_only before update or delete on public.ledger_lines
  for each row execute function public.ledger_refuse_change();

-- Post one journal. Returns false if a journal with this key already exists.
create or replace function public.ledger_post(p_journal jsonb) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_dr bigint;
  v_cr bigint;
begin
  if p_journal is null or p_journal = 'null'::jsonb then
    return true;
  end if;
  insert into public.ledger_journals (idempotency_key, kind, booking_group_id, memo)
  values (p_journal ->> 'idempotencyKey', p_journal ->> 'kind', nullif(p_journal ->> 'bookingGroupId', '')::uuid, p_journal ->> 'memo')
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;

  insert into public.ledger_lines (journal_id, account, debit_cents, credit_cents)
  select v_id, l ->> 'account', (l ->> 'debitCents')::bigint, (l ->> 'creditCents')::bigint
    from jsonb_array_elements(p_journal -> 'lines') l;

  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0) into v_dr, v_cr
    from public.ledger_lines where journal_id = v_id;
  if v_dr <> v_cr or v_dr = 0 then
    raise exception 'unbalanced journal %: debits % credits %', p_journal ->> 'idempotencyKey', v_dr, v_cr using errcode = '23514';
  end if;
  return true;
end;
$$;

-- ── 8. Notification outbox ───────────────────────────────────────────────────

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null,
  channel text not null check (channel in ('in_app', 'email', 'sms')),
  user_id text not null,
  booking_ids uuid[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'skipped')),
  attempts integer not null default 0,
  send_after timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notification_outbox_todo on public.notification_outbox (created_at)
  where status in ('pending', 'failed', 'sending');

create or replace function public.outbox_enqueue(p_notices jsonb) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_notices is null or jsonb_typeof(p_notices) <> 'array' then
    return 0;
  end if;
  insert into public.notification_outbox (dedupe_key, kind, channel, user_id, booking_ids, data, send_after)
  select n ->> 'dedupeKey', n ->> 'kind', n ->> 'channel', n ->> 'userId',
         coalesce(array(select jsonb_array_elements_text(n -> 'bookingIds'))::uuid[], '{}'),
         coalesce(n -> 'data', '{}'::jsonb), nullif(n ->> 'sendAfter', '')::timestamptz
    from jsonb_array_elements(p_notices) n
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_outbox(p_limit integer, p_max_attempts integer default 5)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notification_outbox set status = 'dead'
   where status in ('failed', 'sending') and attempts >= p_max_attempts;
  return query
  update public.notification_outbox o
     set status = 'sending', attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where (status in ('pending', 'failed') or (status = 'sending' and created_at < now() - interval '10 minutes'))
        and coalesce(send_after, now()) <= now()
      order by created_at
      limit p_limit
      for update skip locked)
  returning o.*;
end;
$$;

-- ── 9. Refund obligations ────────────────────────────────────────────────────

create table if not exists public.refund_obligations (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null unique,
  reason text not null check (reason in ('deposit_settlement', 'cancellation', 'late_payment', 'overpayment', 'manual')),
  state text not null default 'eligible' check (state in (
    'eligible', 'claimed', 'requested', 'pending', 'processing', 'processed', 'failed', 'needs_attention', 'disputed')),
  amount_cents integer not null check (amount_cents > 0),
  charged_cents integer not null check (charged_cents > 0),
  transaction_reference text not null,
  provider text not null default 'paystack',
  provider_refund_id text unique,
  user_id uuid,
  booking_group_id uuid,
  booking_ids uuid[] not null default '{}',
  from_unallocated boolean not null default false,
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  evidence jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  check (amount_cents <= charged_cents)
);
create index if not exists idx_refund_obligations_open on public.refund_obligations (state)
  where state not in ('processed');
create index if not exists idx_refund_obligations_tx on public.refund_obligations (transaction_reference);

-- T14: the refunds against one charge can never add up to more than the charge.
create or replace function public.refund_obligations_cap() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sum bigint;
begin
  -- A re-insert of an existing obligation is a no-op (ON CONFLICT DO NOTHING); don't count it twice.
  if tg_op = 'INSERT' and exists (select 1 from public.refund_obligations where obligation_key = new.obligation_key) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('refund:' || new.transaction_reference));
  select coalesce(sum(amount_cents), 0) into v_sum
    from public.refund_obligations
   where transaction_reference = new.transaction_reference
     and state <> 'failed'
     and id <> new.id;
  if v_sum + new.amount_cents > new.charged_cents then
    raise exception 'refunds would exceed the original charge (% + % > %)', v_sum, new.amount_cents, new.charged_cents
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists refund_obligations_cap on public.refund_obligations;
create trigger refund_obligations_cap before insert or update of amount_cents, state on public.refund_obligations
  for each row execute function public.refund_obligations_cap();

-- ── 10. Owner payouts ────────────────────────────────────────────────────────

create table if not exists public.owner_payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.equipment_bookings(id) on delete restrict,
  owner_id uuid not null,
  booking_group_id uuid,
  gross_rental_amount_cents integer not null check (gross_rental_amount_cents >= 0),
  platform_commission_cents integer not null check (platform_commission_cents >= 0),
  owner_amount_cents integer not null check (owner_amount_cents > 0),
  provider_fee_cents integer,
  provider text not null default 'paystack',
  transfer_reference text not null unique,
  recipient_code text,
  provider_transfer_code text,
  state text not null default 'scheduled' check (state in (
    'scheduled', 'held', 'approved', 'claimed', 'pending', 'otp', 'received', 'success',
    'failed', 'reversed', 'blocked', 'rejected', 'abandoned', 'needs_attention')),
  hold_reasons text[] not null default '{}',
  scheduled_at timestamptz not null,
  approved_at timestamptz,
  approved_by uuid,
  claimed_at timestamptz,
  processed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_amount_cents + platform_commission_cents = gross_rental_amount_cents)
);
create index if not exists idx_owner_payouts_open on public.owner_payouts (state, scheduled_at)
  where state not in ('success');

-- ── 11. History and escalations ──────────────────────────────────────────────

create table if not exists public.booking_status_history (
  id bigserial primary key,
  booking_id uuid not null,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('system', 'customer', 'staff', 'owner')),
  actor_id uuid,
  reason text,
  at timestamptz not null default now()
);
create index if not exists idx_booking_status_history_booking on public.booking_status_history (booking_id, at);
drop trigger if exists booking_status_history_append_only on public.booking_status_history;
create trigger booking_status_history_append_only before update or delete on public.booking_status_history
  for each row execute function public.ledger_refuse_change();

create table if not exists public.rental_escalations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.equipment_bookings(id) on delete cascade,
  stage text not null check (stage in ('reminder', 'phone_follow_up', 'formal_escalation', 'senior_review')),
  hours_late numeric not null,
  created_at timestamptz not null default now(),
  acted_by uuid,
  acted_at timestamptz,
  outcome text,
  notes text,
  unique (booking_id, stage)
);

-- ── 12. RPCs ─────────────────────────────────────────────────────────────────

-- Confirm a verified payment for one checkout, atomically.
create or replace function public.confirm_rental_payment(
  p_reference text,
  p_provider_transaction_id text,
  p_amount_cents integer,
  p_late boolean,
  p_journal jsonb,
  p_notices jsonb
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.rental_payment_intents;
  v_late boolean;
  v_bad integer;
  v_line record;
  v_stock integer;
  v_ids uuid[];
begin
  select * into v_intent from public.rental_payment_intents where reference = p_reference for update;
  if not found then
    return 'not_confirmable';
  end if;
  if v_intent.state = 'paid' and v_intent.provider_transaction_id = p_provider_transaction_id then
    return 'duplicate';
  end if;
  if v_intent.state not in ('initiated', 'failed', 'expired') or p_amount_cents <> v_intent.expected_amount_cents then
    return 'not_confirmable';
  end if;

  v_late := p_late or v_intent.hold_expires_at <= now();

  perform 1 from public.smart_rentals r
   where r.id in (select rental_id from public.equipment_bookings where checkout_group_id = v_intent.checkout_group_id)
   order by r.id for update;
  perform 1 from public.equipment_bookings where checkout_group_id = v_intent.checkout_group_id for update;

  select count(*) into v_bad from public.equipment_bookings
   where checkout_group_id = v_intent.checkout_group_id
     and not (status = 'pending' or (v_late and status = 'cancelled' and cancel_reason = 'hold_expired'));
  if v_bad > 0 then
    return 'not_confirmable';
  end if;

  if v_late then
    for v_line in
      select * from public.equipment_bookings where checkout_group_id = v_intent.checkout_group_id
    loop
      select coalesce(quantity, 1) into v_stock from public.smart_rentals where id = v_line.rental_id;
      if public.rental_units_blocked(v_line.rental_id, v_line.start_date, v_line.end_date, v_intent.checkout_group_id)
         + v_line.quantity > coalesce(v_stock, 0) then
        return 'unavailable';
      end if;
    end loop;
  end if;

  insert into public.booking_status_history (booking_id, from_status, to_status, actor, reason)
  select id, status, 'confirmed', 'system', 'verified payment ' || p_provider_transaction_id
    from public.equipment_bookings where checkout_group_id = v_intent.checkout_group_id;

  with moved as (
    update public.equipment_bookings
       set status = 'confirmed',
           payfast_payment_id = p_provider_transaction_id,
           cancelled_at = null,
           cancel_reason = null,
           hold_expires_at = null,
           updated_at = now()
     where checkout_group_id = v_intent.checkout_group_id
     returning id
  )
  select array_agg(id) into v_ids from moved;

  update public.rental_payment_intents
     set state = 'paid', provider_transaction_id = p_provider_transaction_id, paid_at = now(), updated_at = now()
   where id = v_intent.id;

  update public.booking_payments set status = 'succeeded'
   where booking_id = any(v_ids) and status = 'pending';

  perform public.ledger_post(p_journal);
  perform public.outbox_enqueue(p_notices);
  return 'confirmed';
end;
$$;

-- Money that arrived but cannot be applied: held (mismatch) or owed back (refund_due).
create or replace function public.record_unallocated_payment(
  p_reference text,
  p_provider_transaction_id text,
  p_amount_cents integer,
  p_intent_state text,
  p_reason text,
  p_refund jsonb,
  p_journal jsonb,
  p_notices jsonb
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.rental_payment_intents;
begin
  if p_intent_state not in ('mismatch', 'refund_due') then
    raise exception 'invalid intent state %', p_intent_state using errcode = '22023';
  end if;
  if not public.ledger_post(p_journal) then
    return 'duplicate';
  end if;

  select * into v_intent from public.rental_payment_intents where reference = p_reference for update;
  if found then
    update public.rental_payment_intents
       set state = p_intent_state, mismatch_reason = p_reason, updated_at = now()
     where id = v_intent.id and state in ('initiated', 'failed', 'expired');
  end if;

  if p_refund is not null and p_refund <> 'null'::jsonb then
    insert into public.refund_obligations (
      obligation_key, reason, amount_cents, charged_cents, transaction_reference, user_id,
      booking_group_id, booking_ids, from_unallocated)
    values (
      p_refund ->> 'key', p_refund ->> 'reason', (p_refund ->> 'amountCents')::int, p_amount_cents,
      p_provider_transaction_id, v_intent.user_id, v_intent.checkout_group_id,
      coalesce((select array_agg(id) from public.equipment_bookings where checkout_group_id = v_intent.checkout_group_id), '{}'),
      true)
    on conflict (obligation_key) do nothing;
  end if;

  perform public.outbox_enqueue(p_notices);
  return 'recorded';
end;
$$;

create or replace function public.record_failed_payment_attempt(p_reference text) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.rental_payment_intents
     set state = case when state = 'initiated' then 'failed' else state end,
         failed_attempts = failed_attempts + 1,
         updated_at = now()
   where reference = p_reference and state in ('initiated', 'failed');
$$;

-- Guarded booking transition, with its history, journals, refunds, payouts and
-- notices, all in one transaction.
-- Returns: number of rows moved, 0 if already done, -1 if the state changed underneath.
create or replace function public.transition_rental_booking(
  p_ids uuid[],
  p_from text[],
  p_to text,
  p_actor text,
  p_actor_id uuid,
  p_reason text,
  p_patch jsonb,
  p_journals jsonb,
  p_refunds jsonb,
  p_payouts jsonb,
  p_notices jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_in_from integer;
  v_in_to integer;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_j jsonb;
  v_moved integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return -1;
  end if;

  perform 1 from public.equipment_bookings where id = any(p_ids) order by id for update;
  select count(*), count(*) filter (where status = any(p_from)), count(*) filter (where status = p_to)
    into v_total, v_in_from, v_in_to
    from public.equipment_bookings where id = any(p_ids);

  if v_total <> array_length(p_ids, 1) then
    return -1;
  end if;
  if v_in_to = v_total then
    return 0;
  end if;
  if v_in_from <> v_total then
    return -1;
  end if;

  insert into public.booking_status_history (booking_id, from_status, to_status, actor, actor_id, reason)
  select id, status, p_to, p_actor, p_actor_id, p_reason from public.equipment_bookings where id = any(p_ids);

  -- Only these columns can be changed alongside a transition.
  update public.equipment_bookings b set
    status = p_to,
    updated_at = now(),
    handover = case when v_patch ? 'handover' then v_patch -> 'handover' else b.handover end,
    condition_at_checkout = case when v_patch ? 'condition_at_checkout' then v_patch ->> 'condition_at_checkout' else b.condition_at_checkout end,
    checkout_photos = case when v_patch ? 'checkout_photos' then v_patch -> 'checkout_photos' else b.checkout_photos end,
    condition_at_return = case when v_patch ? 'condition_at_return' then v_patch ->> 'condition_at_return' else b.condition_at_return end,
    return_photos = case when v_patch ? 'return_photos' then v_patch -> 'return_photos' else b.return_photos end,
    return_notes = case when v_patch ? 'return_notes' then v_patch ->> 'return_notes' else b.return_notes end,
    returned_at = case when v_patch ? 'returned_at' then (v_patch ->> 'returned_at')::timestamptz else b.returned_at end,
    return_evidence = case when v_patch ? 'return_evidence' then v_patch -> 'return_evidence' else b.return_evidence end,
    inspection_outcome = case when v_patch ? 'inspection_outcome' then v_patch ->> 'inspection_outcome' else b.inspection_outcome end,
    late_fee = case when v_patch ? 'late_fee' then (v_patch ->> 'late_fee')::numeric else b.late_fee end,
    damage_fee = case when v_patch ? 'damage_fee' then (v_patch ->> 'damage_fee')::numeric else b.damage_fee end,
    deposit_released = case when v_patch ? 'deposit_released' then (v_patch ->> 'deposit_released')::numeric else b.deposit_released end,
    deposit_released_at = case when v_patch ? 'deposit_released_at' then (v_patch ->> 'deposit_released_at')::timestamptz else b.deposit_released_at end,
    deposit_refund_method = case when v_patch ? 'deposit_refund_method' then v_patch ->> 'deposit_refund_method' else b.deposit_refund_method end,
    return_reviewed_by = case when v_patch ? 'return_reviewed_by' then (v_patch ->> 'return_reviewed_by')::uuid else b.return_reviewed_by end,
    return_reviewed_at = case when v_patch ? 'return_reviewed_at' then (v_patch ->> 'return_reviewed_at')::timestamptz else b.return_reviewed_at end,
    dispute_reason = case when v_patch ? 'dispute_reason' then v_patch ->> 'dispute_reason' else b.dispute_reason end,
    disputed_at = case when v_patch ? 'disputed_at' then (v_patch ->> 'disputed_at')::timestamptz else b.disputed_at end,
    cancelled_at = case when p_to = 'cancelled' then now() else b.cancelled_at end,
    cancel_reason = case when v_patch ? 'cancel_reason' then v_patch ->> 'cancel_reason' else b.cancel_reason end,
    cancellation_refund_amount = case when v_patch ? 'cancellation_refund_amount' then (v_patch ->> 'cancellation_refund_amount')::numeric else b.cancellation_refund_amount end,
    cancellation_fee = case when v_patch ? 'cancellation_fee' then (v_patch ->> 'cancellation_fee')::numeric else b.cancellation_fee end,
    cancellation_refund_percent = case when v_patch ? 'cancellation_refund_percent' then (v_patch ->> 'cancellation_refund_percent')::int else b.cancellation_refund_percent end,
    cancellation_refund_status = case when v_patch ? 'cancellation_refund_status' then v_patch ->> 'cancellation_refund_status' else b.cancellation_refund_status end,
    completed_at = case when p_to = 'completed' then now() else b.completed_at end
  where b.id = any(p_ids) and b.status = any(p_from);
  get diagnostics v_moved = row_count;

  if p_journals is not null and jsonb_typeof(p_journals) = 'array' then
    for v_j in select * from jsonb_array_elements(p_journals) loop
      perform public.ledger_post(v_j);
    end loop;
  end if;

  if p_refunds is not null and jsonb_typeof(p_refunds) = 'array' then
    insert into public.refund_obligations (
      obligation_key, reason, amount_cents, charged_cents, transaction_reference, provider, user_id,
      booking_group_id, booking_ids, evidence, created_by)
    select r ->> 'obligationKey', r ->> 'reason', (r ->> 'amountCents')::int, (r ->> 'chargedCents')::int,
           r ->> 'transactionReference', coalesce(r ->> 'provider', 'paystack'), (r ->> 'userId')::uuid,
           nullif(r ->> 'bookingGroupId', '')::uuid,
           coalesce(array(select jsonb_array_elements_text(r -> 'bookingIds'))::uuid[], '{}'),
           r -> 'evidence', p_actor_id
      from jsonb_array_elements(p_refunds) r
    on conflict (obligation_key) do nothing;
  end if;

  if p_payouts is not null and jsonb_typeof(p_payouts) = 'array' then
    insert into public.owner_payouts (
      booking_id, owner_id, booking_group_id, gross_rental_amount_cents, platform_commission_cents,
      owner_amount_cents, transfer_reference, scheduled_at)
    select (p ->> 'bookingId')::uuid, (p ->> 'ownerId')::uuid, nullif(p ->> 'bookingGroupId', '')::uuid,
           (p ->> 'grossCents')::int, (p ->> 'platformCents')::int, (p ->> 'ownerCents')::int,
           p ->> 'transferReference', (p ->> 'scheduledAt')::timestamptz
      from jsonb_array_elements(p_payouts) p
    on conflict (booking_id) do nothing;
  end if;

  perform public.outbox_enqueue(p_notices);
  return v_moved;
end;
$$;

create or replace function public.refund_transition(
  p_id uuid,
  p_from text[],
  p_to text,
  p_patch jsonb,
  p_journal jsonb,
  p_notices jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.refund_obligations;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  update public.refund_obligations r set
    state = p_to,
    updated_at = now(),
    provider_refund_id = coalesce(nullif(v_patch ->> 'providerRefundId', ''), r.provider_refund_id),
    last_error = case when v_patch ? 'lastError' then v_patch ->> 'lastError' else r.last_error end,
    claimed_at = case when (v_patch ->> 'claim')::boolean then now() else r.claimed_at end,
    attempts = case when (v_patch ->> 'claim')::boolean then r.attempts + 1 else r.attempts end,
    processed_at = case when p_to = 'processed' then now() else r.processed_at end
  where r.id = p_id and r.state = any(p_from)
  returning * into v_row;
  if not found then
    return false;
  end if;

  if v_row.reason = 'cancellation' and p_to in ('processed', 'failed') then
    update public.equipment_bookings
       set cancellation_refund_status = case when p_to = 'processed' then 'refunded' else 'failed' end,
           cancellation_refunded_at = case when p_to = 'processed' then now() else cancellation_refunded_at end
     where id = any(v_row.booking_ids);
  end if;
  if v_row.from_unallocated and p_to = 'processed' then
    update public.rental_payment_intents set state = 'refunded', updated_at = now()
     where checkout_group_id = v_row.booking_group_id and state in ('refund_due', 'mismatch');
  end if;

  perform public.ledger_post(p_journal);
  perform public.outbox_enqueue(p_notices);
  return true;
end;
$$;

create or replace function public.payout_transition(
  p_id uuid,
  p_from text[],
  p_to text,
  p_patch jsonb,
  p_journal jsonb,
  p_notices jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  update public.owner_payouts p set
    state = p_to,
    updated_at = now(),
    provider_transfer_code = coalesce(nullif(v_patch ->> 'providerTransferCode', ''), p.provider_transfer_code),
    recipient_code = coalesce(nullif(v_patch ->> 'recipientCode', ''), p.recipient_code),
    last_error = case when v_patch ? 'lastError' then v_patch ->> 'lastError' else p.last_error end,
    hold_reasons = case when v_patch ? 'holdReasons' then array(select jsonb_array_elements_text(v_patch -> 'holdReasons')) else p.hold_reasons end,
    approved_at = case when p_to = 'approved' then now() else p.approved_at end,
    approved_by = case when v_patch ? 'approvedBy' then (v_patch ->> 'approvedBy')::uuid else p.approved_by end,
    claimed_at = case when (v_patch ->> 'claim')::boolean then now() else p.claimed_at end,
    processed_at = case when p_to in ('pending', 'otp', 'received') and p.processed_at is null then now() else p.processed_at end,
    completed_at = case when p_to = 'success' then now() else p.completed_at end
  where p.id = p_id and p.state = any(p_from);
  if not found then
    return false;
  end if;
  perform public.ledger_post(p_journal);
  perform public.outbox_enqueue(p_notices);
  return true;
end;
$$;

-- Release unpaid holds that have run out. Paid-but-unconfirmed rows are never touched.
create or replace function public.expire_rental_holds() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.equipment_bookings b
       set status = 'cancelled', cancel_reason = 'hold_expired', cancelled_at = now(), updated_at = now(),
           cancellation_refund_status = coalesce(b.cancellation_refund_status, 'not_required')
     where b.status = 'pending'
       and b.payfast_payment_id is null
       and b.hold_expires_at is not null
       and b.hold_expires_at <= now()
       and not exists (
         select 1 from public.rental_payment_intents i
          where i.checkout_group_id = b.checkout_group_id and i.state = 'paid')
    returning b.id
  )
  insert into public.booking_status_history (booking_id, from_status, to_status, actor, reason)
  select id, 'pending', 'cancelled', 'system', 'hold expired' from expired;
  get diagnostics v_count = row_count;

  update public.rental_payment_intents i
     set state = 'expired', updated_at = now()
   where i.state in ('initiated', 'failed') and i.hold_expires_at <= now()
     and not exists (select 1 from public.equipment_bookings b where b.checkout_group_id = i.checkout_group_id and b.status = 'pending');
  return v_count;
end;
$$;

-- ── 13. Notification types ───────────────────────────────────────────────────

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed', 'gig_cancelled', 'gig_expired',
  'gig_paid', 'gig_unassigned',
  'booking_accepted', 'booking_rejected', 'booking_completed', 'booking_cancelled', 'booking_reassigned',
  'booking_admin_cancelled', 'booking_admin_completed', 'booking_assigned', 'booking_confirmed',
  'booking_delivered', 'booking_expired',
  'payment_received', 'payment_confirmed',
  'payout_initiated', 'payout_completed', 'payout_complete', 'payout_processing',
  'rental_overdue', 'rental_return_pending', 'rental_return_reviewed',
  'dispute_filed', 'dispute_updated', 'dispute_comment',
  'cart_reminder',
  'creator_arrived', 'work_delivered',
  'gear_confirmed', 'gear_collect_tomorrow', 'gear_return_tomorrow', 'gear_settled', 'gear_not_returned',
  'gear_awaiting_payment', 'gear_payment_reminder', 'gear_payment_released',
  -- 070: rental pipeline notices (type = 'rental_' || outbox kind)
  'rental_payment_received', 'rental_booking_confirmed', 'rental_collection_reminder', 'rental_handover_completed',
  'rental_return_reminder', 'rental_overdue_reminder', 'rental_return_recorded', 'rental_inspection_completed',
  'rental_refund_initiated', 'rental_refund_processed', 'rental_refund_failed', 'rental_payout_scheduled',
  'rental_payout_completed', 'rental_payout_failed', 'rental_dispute_opened', 'rental_dispute_resolved',
  'rental_late_payment_refund', 'rental_staff_alert'
]::text[]));

-- ── 14. Access ───────────────────────────────────────────────────────────────

alter table public.rental_blocks enable row level security;
alter table public.rental_payment_intents enable row level security;
alter table public.payment_events enable row level security;
alter table public.ledger_journals enable row level security;
alter table public.ledger_lines enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.refund_obligations enable row level security;
alter table public.owner_payouts enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.rental_escalations enable row level security;

revoke all on public.rental_blocks, public.rental_payment_intents, public.payment_events, public.ledger_journals,
  public.ledger_lines, public.notification_outbox, public.refund_obligations, public.owner_payouts,
  public.booking_status_history, public.rental_escalations from anon, authenticated;
grant select on public.rental_payment_intents, public.refund_obligations, public.owner_payouts, public.rental_blocks,
  public.booking_status_history to authenticated;
grant all on public.rental_blocks, public.rental_payment_intents, public.payment_events, public.notification_outbox,
  public.refund_obligations, public.owner_payouts, public.rental_escalations to service_role;
-- Ledger and history: service_role may insert and read, never change.
grant select, insert on public.ledger_journals, public.ledger_lines, public.booking_status_history to service_role;
grant usage on sequence public.ledger_lines_id_seq, public.booking_status_history_id_seq to service_role;
revoke update, delete, truncate on public.ledger_journals, public.ledger_lines, public.booking_status_history from service_role;

drop policy if exists "Own payment intents" on public.rental_payment_intents;
create policy "Own payment intents" on public.rental_payment_intents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Own refunds" on public.refund_obligations;
create policy "Own refunds" on public.refund_obligations for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Own payouts" on public.owner_payouts;
create policy "Own payouts" on public.owner_payouts for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "Admins read rental blocks" on public.rental_blocks;
create policy "Admins read rental blocks" on public.rental_blocks for select to authenticated using (public.is_admin());
drop policy if exists "Own booking history" on public.booking_status_history;
create policy "Own booking history" on public.booking_status_history for select to authenticated
  using (public.is_admin() or exists (select 1 from public.equipment_bookings b where b.id = booking_id and b.user_id = auth.uid()));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rental_units_blocked(uuid, date, date, uuid)',
    'public.reserve_rental_order(jsonb, jsonb, integer)',
    'public.claim_payment_events(integer, integer)',
    'public.ledger_post(jsonb)',
    'public.outbox_enqueue(jsonb)',
    'public.claim_outbox(integer, integer)',
    'public.confirm_rental_payment(text, text, integer, boolean, jsonb, jsonb)',
    'public.record_unallocated_payment(text, text, integer, text, text, jsonb, jsonb, jsonb)',
    'public.record_failed_payment_attempt(text)',
    'public.transition_rental_booking(uuid[], text[], text, text, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb)',
    'public.refund_transition(uuid, text[], text, jsonb, jsonb, jsonb)',
    'public.payout_transition(uuid, text[], text, jsonb, jsonb, jsonb)',
    'public.expire_rental_holds()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

-- ── ROLLBACK (manual; only before any Phase 1 code has written to these tables) ──
--   begin;
--   drop function if exists public.expire_rental_holds(), public.payout_transition(uuid, text[], text, jsonb, jsonb, jsonb),
--     public.refund_transition(uuid, text[], text, jsonb, jsonb, jsonb),
--     public.transition_rental_booking(uuid[], text[], text, text, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb),
--     public.record_failed_payment_attempt(text), public.record_unallocated_payment(text, text, integer, text, text, jsonb, jsonb, jsonb),
--     public.confirm_rental_payment(text, text, integer, boolean, jsonb, jsonb), public.claim_outbox(integer, integer),
--     public.outbox_enqueue(jsonb), public.ledger_post(jsonb), public.claim_payment_events(integer, integer),
--     public.reserve_rental_order(jsonb, jsonb, integer), public.rental_units_blocked(uuid, date, date, uuid);
--   drop table if exists public.rental_escalations, public.booking_status_history, public.owner_payouts,
--     public.refund_obligations, public.notification_outbox, public.ledger_lines, public.ledger_journals,
--     public.payment_events, public.rental_payment_intents, public.rental_blocks;
--   drop function if exists public.refund_obligations_cap(), public.ledger_refuse_change();
--   -- equipment_bookings columns are left in place (nullable, harmless). Restore the 066 notifications_type_check.
--   commit;
-- Once real money has moved through these tables, do NOT drop them: they are the financial record.
