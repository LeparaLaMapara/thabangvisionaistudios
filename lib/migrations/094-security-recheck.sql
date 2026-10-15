-- 094: fixes from the security re-check of 2026-10-15 (the repo went public).
--
-- Needs 083 (orders policies) and 090 to 092 (role_evidence). One
-- transaction, safe to run twice. The site reads and writes as before (the
-- order route's update now also works where it was a silent no-op).
--
-- WHAT THIS DOES
--   1. role_evidence: the public read is for browsers that are not signed in
--      only, and only on the columns a work gallery needs. Before, anon AND
--      every signed-in user could read every column of an approved profile's
--      public rows through the REST API: device_summary (phone make, model,
--      software), captured_at, booking_id, verified_by (a staff user id),
--      note, and source_production_id, which points at the studio package the
--      work came from (a package names its crew, so this can undo the blind
--      People rule). The site reads other people's evidence on the server
--      with the service role (lib/supabase/queries/roles.ts), so nothing in
--      the site used the browser read. Vouches and bookings are never public
--      (a vouch's note is a name and a phone number): the policy now allows
--      only photo, video and link rows. storage_ref (a path carrying the
--      person's user id) is not readable by browsers either.
--   2. role_evidence: browsers can no longer insert proof straight through
--      the REST API. They could file any URL as their work with
--      source 'captured_in_app' (skipping the server's classifySource and
--      own-upload checks), and approval stamps those items verified, which
--      raises the evidence level. /api/roles/offer and
--      /api/roles/[slug]/evidence now write with the service role after
--      their checks. The owner's delete (unchecked items, editable profile)
--      stays.
--   3. orders: a buyer or seller could change ANY column of their order
--      straight through the REST API (status 'paid', total, seller_id,
--      platform_fee, seller_payout), skipping /api/orders/[id]'s rules. Now
--      the client may update only status and notes, and a trigger enforces
--      the route's moves: a buyer may only cancel a pending order; a seller
--      moves one step at a time, paid -> shipped -> delivered -> completed.
--      The service role (PayFast ITN, admin) is not limited. The two update
--      policies are (re)created under one name in every environment.
--
-- ROLLBACK: scripts/db/rollback/094-security-recheck.sql

begin;

-- ── 1. role_evidence: blind public read ─────────────────────────────────────

drop policy if exists "Role evidence: public reads approved public work" on public.role_evidence;
create policy "Role evidence: public reads approved public work" on public.role_evidence
  for select to anon using (
    is_public and kind in ('photo', 'video', 'link')
    and exists (select 1 from public.person_roles pr where pr.id = person_role_id and pr.status = 'approved')
  );

-- anon: the gallery columns only. Signed-in users keep the full column grant:
-- RLS now limits them to their own rows (own read) or staff (admin read).
revoke select on public.role_evidence from anon;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(c), ', ') into v_cols
    from unnest(array['id', 'person_role_id', 'step_key', 'kind', 'media_kind', 'url', 'storage_provider',
                      'is_public', 'pair_group', 'pair_side', 'album', 'is_demo', 'created_at']) c
   where exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'role_evidence' and column_name = c);
  execute format('grant select (%s) on public.role_evidence to anon', v_cols);
end $$;

-- ── 2. role_evidence: written by the server only ────────────────────────────

revoke insert on public.role_evidence from anon, authenticated;
drop policy if exists "Role evidence: own insert" on public.role_evidence;

-- ── 3. orders: only the route's moves, only status and notes ────────────────

revoke update on public.orders from anon, authenticated;
revoke insert, delete on public.orders from anon, authenticated;
grant update (status, notes, updated_at) on public.orders to authenticated;

create or replace function public.orders_guard_client_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if v_uid is null then
    raise exception 'orders: sign in to change an order' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'notes', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'notes', 'updated_at']) then
    raise exception 'orders: only the status and notes can be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if v_uid = old.buyer_id and old.status = 'pending' and new.status = 'cancelled' then
      return new;
    end if;
    if v_uid = old.seller_id and (
         (old.status = 'paid' and new.status = 'shipped')
      or (old.status = 'shipped' and new.status = 'delivered')
      or (old.status = 'delivered' and new.status = 'completed')) then
      return new;
    end if;
    raise exception 'orders: cannot move this order from % to %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.orders_guard_client_update() from public, anon, authenticated;

-- The same two update policies everywhere. Prod has them (083 kept them for
-- the route); a database rebuilt from the repo and dev never had them, so
-- the route's update was a silent no-op there. The trigger is what limits
-- them now.
drop policy if exists "Orders: buyer update" on public.orders;
create policy "Orders: buyer update" on public.orders
  for update to authenticated
  using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()));
drop policy if exists "Orders: seller update" on public.orders;
create policy "Orders: seller update" on public.orders
  for update to authenticated
  using (seller_id = (select auth.uid()))
  with check (seller_id = (select auth.uid()));

drop trigger if exists orders_guard_client_update on public.orders;
create trigger orders_guard_client_update before update on public.orders
  for each row execute function public.orders_guard_client_update();

notify pgrst, 'reload schema';

commit;
