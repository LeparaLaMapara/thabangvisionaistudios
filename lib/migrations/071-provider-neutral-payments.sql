-- 071 — Provider-neutral payment and payout references (Phase 2, spec §8.4)
--
-- WHY
--   Payment references live in columns named after one provider:
--   equipment_bookings.payfast_payment_id and booking_payments.payfast_payment_id
--   hold whatever provider took the money (Paystack, Yoco or a manual
--   reference), and bookings.paystack_reference holds any provider's id too.
--   Adding a provider must not mean another provider-named column.
--
-- WHAT (steps 1–4 of the additive plan; readers are NOT migrated yet)
--   1. Add payment_provider / provider_reference (and payout_provider on
--      bookings, whose payout_reference is already neutral).
--   2. Backfill provider_reference from the legacy column. payment_provider is
--      backfilled only where the history says it for certain: a 070 payment
--      intent for the order, or a 'manual:' reference. Everything else stays
--      NULL (unknown) rather than guessed.
--   3. Dual-write: a trigger keeps the neutral columns in step whenever the
--      legacy column is written, so existing code needs no change.
--   4. Reconciliation: payment_reference_mismatches lists any row where the two
--      disagree. It must be empty before readers move (step 5) and before any
--      legacy column is dropped (step 6, needs evidence and founder approval).
--
-- SAFETY
--   Additive and re-runnable. Nothing is dropped or renamed. No payment
--   history changes. Rollback at the end.

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.equipment_bookings
  add column if not exists payment_provider text,
  add column if not exists provider_reference text;

alter table public.booking_payments
  add column if not exists payment_provider text,
  add column if not exists provider_reference text;

do $$
begin
  if to_regclass('public.bookings') is not null then
    alter table public.bookings
      add column if not exists payment_provider text,
      add column if not exists provider_reference text,
      add column if not exists payout_provider text;
  end if;
end $$;

-- ── 2. Backfill ──────────────────────────────────────────────────────────────

update public.equipment_bookings b
   set provider_reference = b.payfast_payment_id
 where b.provider_reference is null and b.payfast_payment_id is not null;

update public.equipment_bookings b
   set payment_provider = case
         when b.payfast_payment_id like 'manual:%' then 'manual'
         else (select i.provider from public.rental_payment_intents i
                where i.checkout_group_id = b.checkout_group_id and i.state = 'paid')
       end
 where b.payment_provider is null and b.payfast_payment_id is not null;

update public.booking_payments p
   set provider_reference = p.payfast_payment_id,
       payment_provider = case when p.payfast_payment_id like 'manual:%' then 'manual' else p.payment_provider end
 where p.provider_reference is null and p.payfast_payment_id is not null;

do $$
begin
  if to_regclass('public.bookings') is not null then
    update public.bookings
       set provider_reference = paystack_reference
     where provider_reference is null and paystack_reference is not null;
    -- payout_reference is already neutral; the only payout provider wired is Paystack.
    update public.bookings
       set payout_provider = 'paystack'
     where payout_provider is null and payout_reference is not null;
  end if;
end $$;

-- ── 3. Dual-write ────────────────────────────────────────────────────────────

create or replace function public.equipment_bookings_neutral_payment() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.payfast_payment_id is distinct from old.payfast_payment_id then
    new.provider_reference := new.payfast_payment_id;
    if new.payfast_payment_id is null then
      new.payment_provider := null;
    elsif new.payfast_payment_id like 'manual:%' then
      new.payment_provider := 'manual';
    elsif new.checkout_group_id is not null then
      new.payment_provider := coalesce(
        (select i.provider from public.rental_payment_intents i where i.checkout_group_id = new.checkout_group_id),
        new.payment_provider);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_bookings_neutral_payment on public.equipment_bookings;
create trigger equipment_bookings_neutral_payment before insert or update of payfast_payment_id
  on public.equipment_bookings for each row execute function public.equipment_bookings_neutral_payment();

create or replace function public.booking_payments_neutral_payment() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.payfast_payment_id is distinct from old.payfast_payment_id then
    new.provider_reference := new.payfast_payment_id;
    if new.payfast_payment_id like 'manual:%' then new.payment_provider := 'manual'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_payments_neutral_payment on public.booking_payments;
create trigger booking_payments_neutral_payment before insert or update of payfast_payment_id
  on public.booking_payments for each row execute function public.booking_payments_neutral_payment();

do $$
begin
  if to_regclass('public.bookings') is not null then
    create or replace function public.bookings_neutral_payment() returns trigger
    language plpgsql
    set search_path = public, pg_temp
    as $f$
    begin
      if tg_op = 'INSERT' or new.paystack_reference is distinct from old.paystack_reference then
        new.provider_reference := new.paystack_reference;
      end if;
      if new.payout_reference is not null and new.payout_provider is null then
        new.payout_provider := 'paystack';
      end if;
      return new;
    end;
    $f$;
    drop trigger if exists bookings_neutral_payment on public.bookings;
    create trigger bookings_neutral_payment before insert or update of paystack_reference, payout_reference
      on public.bookings for each row execute function public.bookings_neutral_payment();
  end if;
end $$;

-- ── 4. Reconciliation ────────────────────────────────────────────────────────

create or replace view public.payment_reference_mismatches as
  select 'equipment_bookings'::text as table_name, id, payfast_payment_id as legacy_reference, provider_reference
    from public.equipment_bookings
   where provider_reference is distinct from payfast_payment_id
  union all
  select 'booking_payments', id, payfast_payment_id, provider_reference
    from public.booking_payments
   where provider_reference is distinct from payfast_payment_id;

comment on view public.payment_reference_mismatches is
  'Rows whose provider-neutral reference disagrees with the legacy column. Must be empty before readers move to the neutral columns (071 step 5).';

revoke all on public.payment_reference_mismatches from public, anon, authenticated;
grant select on public.payment_reference_mismatches to service_role;

commit;

-- ── ROLLBACK (manual) ────────────────────────────────────────────────────────
--   begin;
--   drop view if exists public.payment_reference_mismatches;
--   drop trigger if exists equipment_bookings_neutral_payment on public.equipment_bookings;
--   drop trigger if exists booking_payments_neutral_payment on public.booking_payments;
--   drop trigger if exists bookings_neutral_payment on public.bookings;
--   drop function if exists public.equipment_bookings_neutral_payment(), public.booking_payments_neutral_payment(), public.bookings_neutral_payment();
--   alter table public.equipment_bookings drop column if exists payment_provider, drop column if exists provider_reference;
--   alter table public.booking_payments drop column if exists payment_provider, drop column if exists provider_reference;
--   alter table public.bookings drop column if exists payment_provider, drop column if exists provider_reference, drop column if exists payout_provider;
--   commit;
-- Safe while no reader uses the neutral columns (they only copy the legacy ones).
