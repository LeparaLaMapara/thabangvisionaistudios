-- Rollback for lib/migrations/098-plan-timeline.sql. Drops the plan
-- timeline (due dates, steps, order), the plan move function and plan move
-- proposals, and puts back the 097 versions of project_create and
-- project_link_item. Plans stay; no booking, request or payment is touched.
-- Not in lib/migrations on purpose.

begin;

drop function if exists public.project_move_date(uuid, uuid, date, date, text, integer);

delete from public.agent_actions where kind = 'project_update';
alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check
  check (kind in ('gear_booking', 'service_booking', 'project_create'));

create or replace function public.project_create(p_client uuid, p_title text, p_brief jsonb, p_conversation uuid, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_kind text;
  v_ref uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'project_create: no parts' using errcode = '22023';
  end if;
  insert into public.projects (client_id, title, brief, source_conversation_id)
  values (p_client, btrim(p_title), coalesce(p_brief, '{}'::jsonb), p_conversation)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    if v_kind = 'need' then
      insert into public.project_items (project_id, kind, need) values (v_id, 'need', v_item->'need');
    else
      v_ref := (v_item->>'ref_id')::uuid;
      if not public.project_ref_owned(p_client, v_kind, v_ref) then
        raise exception 'project_create: not the client''s own %', v_kind using errcode = '42501';
      end if;
      insert into public.project_items (project_id, kind, ref_id) values (v_id, v_kind, v_ref);
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.project_link_item(p_project uuid, p_client uuid, p_kind text, p_ref uuid, p_replaces uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item uuid;
  v_other uuid;
begin
  if not exists (select 1 from public.projects where id = p_project and client_id = p_client and status = 'open') then
    raise exception 'project_link_item: plan not found' using errcode = '42501';
  end if;
  if p_kind not in ('gear_order', 'people_request', 'service_booking') or not public.project_ref_owned(p_client, p_kind, p_ref) then
    raise exception 'project_link_item: not the client''s own %', p_kind using errcode = '42501';
  end if;
  select id, project_id into v_item, v_other from public.project_items where kind = p_kind and ref_id = p_ref;
  if v_item is not null and v_other <> p_project then
    raise exception 'project_link_item: already in another plan' using errcode = '23505';
  end if;
  if v_item is null then
    insert into public.project_items (project_id, kind, ref_id) values (p_project, p_kind, p_ref) returning id into v_item;
  end if;
  if p_replaces is not null then
    delete from public.project_items where id = p_replaces and project_id = p_project and kind = 'need';
  end if;
  update public.projects set updated_at = now() where id = p_project;
  return v_item;
end;
$$;

revoke all on function public.project_create(uuid, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.project_link_item(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_create(uuid, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.project_link_item(uuid, uuid, text, uuid, uuid) to service_role;

alter table public.project_items drop constraint if exists project_items_step_len;
alter table public.project_items drop constraint if exists project_items_position_range;
alter table public.project_items drop column if exists due_date;
alter table public.project_items drop column if exists step;
alter table public.project_items drop column if exists position;

commit;

notify pgrst, 'reload schema';
