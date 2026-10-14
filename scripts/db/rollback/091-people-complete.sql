-- Rollback for lib/migrations/091-people-complete.sql. Removes the new
-- tables and columns and puts back 090's grants and policies. Data in the
-- removed tables and columns is lost (faces, requests, embeddings, team
-- signals, facts, comes_with, profile codes). Face files in the private
-- role-documents bucket stay; delete them from the dashboard if needed.
-- Not in lib/migrations on purpose (rebuild-local.sh applies every .sql there).

begin;

-- 090's evidence policies (they read person_roles directly again).
alter policy "Role evidence: own read" on public.role_evidence
  using (exists (select 1 from public.person_roles pr where pr.id = person_role_id and pr.user_id = (select auth.uid())));
alter policy "Role evidence: own insert" on public.role_evidence
  with check (
    kind in ('photo', 'video', 'document', 'link', 'vouch')
    and source in ('captured_in_app', 'uploaded', 'vouched')
    and (kind = 'vouch') = (source = 'vouched')
    and exists (select 1 from public.person_roles pr
                 where pr.id = person_role_id and pr.user_id = (select auth.uid())
                   and pr.status in ('draft', 'submitted', 'changes_requested'))
  );
alter policy "Role evidence: own delete" on public.role_evidence
  using (verified_at is null and exists (select 1 from public.person_roles pr
                 where pr.id = person_role_id and pr.user_id = (select auth.uid())
                   and pr.status in ('draft', 'submitted', 'changes_requested')));
drop function if exists public.owns_person_role(uuid, boolean);

-- 090's table-wide select.
grant select on public.person_roles to anon, authenticated;

drop table if exists public.team_signals;
drop function if exists public.match_person_roles(extensions.vector, text, integer);
drop table if exists public.person_role_embeddings;
drop table if exists public.role_booking_requests;
drop table if exists public.person_faces;

alter table public.role_evidence drop column if exists media_kind, drop column if exists on_time;

-- 090's stamp trigger body.
create or replace function public.person_roles_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at := now();
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  if (select auth.uid()) is not null and not (select public.is_admin()) then
    if new.status not in ('draft', 'submitted') then
      raise exception 'person_roles: only a reviewer can set status %', new.status using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

alter table public.person_roles
  drop column if exists profile_code,
  drop column if exists facts,
  drop column if exists facts_source,
  drop column if exists facts_reviewed_at,
  drop column if exists comes_with,
  drop column if exists available_days;
drop sequence if exists public.person_role_code_seq;

alter table public.roles drop column if exists proof_format, drop column if exists code_prefix;

notify pgrst, 'reload schema';

commit;
