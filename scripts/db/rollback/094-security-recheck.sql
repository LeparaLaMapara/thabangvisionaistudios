-- Rollback for lib/migrations/094-security-recheck.sql. Puts back the
-- holes 094 closed (anon and every signed-in user read all columns of public
-- evidence, including vouches; browsers insert proof directly; buyers and
-- sellers update any order column).
-- Only for an emergency. Not in lib/migrations on purpose.

begin;

drop policy if exists "Role evidence: public reads approved public work" on public.role_evidence;
create policy "Role evidence: public reads approved public work" on public.role_evidence
  for select to anon, authenticated using (
    is_public and kind <> 'document'
    and exists (select 1 from public.person_roles pr where pr.id = person_role_id and pr.status = 'approved')
  );
grant select on public.role_evidence to anon;
grant insert (person_role_id, step_key, kind, source, legal_code, storage_provider, storage_ref, url, is_public,
              pair_group, pair_side, captured_at, device_summary, note, media_kind, album) on public.role_evidence to authenticated;
drop policy if exists "Role evidence: own insert" on public.role_evidence;
create policy "Role evidence: own insert" on public.role_evidence
  for insert to authenticated with check (
    kind in ('photo', 'video', 'document', 'link', 'vouch')
    and source in ('captured_in_app', 'uploaded', 'vouched')
    and (kind = 'vouch') = (source = 'vouched')
    and public.owns_person_role(person_role_id, true)
  );

drop trigger if exists orders_guard_client_update on public.orders;
drop function if exists public.orders_guard_client_update();
grant update on public.orders to authenticated;
-- Prod's pre-094 policies (no with check). A rebuilt or dev database had none:
-- drop them there instead.
drop policy if exists "Orders: buyer update" on public.orders;
create policy "Orders: buyer update" on public.orders for update to authenticated using (buyer_id = (select auth.uid()));
drop policy if exists "Orders: seller update" on public.orders;
create policy "Orders: seller update" on public.orders for update to authenticated using (seller_id = (select auth.uid()));

notify pgrst, 'reload schema';

commit;
