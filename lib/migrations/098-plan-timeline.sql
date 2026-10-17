-- 098: a timeline on Ubunye plans, and moving a plan to a new date.
--
-- WHY
--   A plan (097) listed its parts but not WHEN each must be done: a
--   traditional wedding needs the photographer asked about four weeks ahead
--   and make-up two weeks ahead, and gear needs its notice. The client saw a
--   list, not an order. And when a shoot moved, nothing on the plan could
--   follow it.
--
-- WHAT
--   1. project_items.due_date (the "do by" day for a part we have not booked
--      yet), project_items.step (the step in plain words, e.g. "Send requests
--      for make-up") and project_items.position (the order on the plan).
--      Planning data only: a booking's own dates are always read live from
--      the booking, never stored here.
--   2. project_create stores due_date, step and position from each item.
--   3. project_link_item: when a booking fills a need, the new item keeps the
--      need's step and position (its due date is met).
--   4. project_move_date: move the client's open plan to a new date. Updates
--      the brief's date, date_label and date_end and shifts the due dates of
--      parts NOT booked yet (needs) by the same number of days, in one
--      transaction. It never touches a booking, a request or a payment.
--   5. agent_actions.kind gains 'project_update': moving a plan from the chat
--      is a Ubunye proposal the client approves on the card, like a new plan.
--
-- SAFETY
--   Additive. No money table, payment code or reserve function changes.
--   project_move_date is server-only (service role) and checks the plan is
--   the client's own and open; browsers still cannot write to plans (097).
--   Safe to run more than once. Needs 097.
--   Test: lib/migrations/098-plan-timeline.test.sql.
--   Rollback: scripts/db/rollback/098-plan-timeline.sql.

begin;

-- ── 1. Timeline columns ─────────────────────────────────────────────────────
alter table public.project_items add column if not exists due_date date;
alter table public.project_items add column if not exists step text;
alter table public.project_items add column if not exists position smallint;
alter table public.project_items drop constraint if exists project_items_step_len;
alter table public.project_items add constraint project_items_step_len
  check (step is null or length(btrim(step)) between 1 and 120);
alter table public.project_items drop constraint if exists project_items_position_range;
alter table public.project_items add constraint project_items_position_range
  check (position is null or position between 0 and 100);

-- ── 2. project_create keeps the timeline ────────────────────────────────────
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
  v_due date;
  v_step text;
  v_pos smallint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'project_create: no parts' using errcode = '22023';
  end if;
  insert into public.projects (client_id, title, brief, source_conversation_id)
  values (p_client, btrim(p_title), coalesce(p_brief, '{}'::jsonb), p_conversation)
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    v_due := case when (v_item->>'due_date') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item->>'due_date')::date else null end;
    v_step := nullif(btrim(coalesce(v_item->>'step', '')), '');
    v_pos := case when (v_item->>'position') ~ '^\d{1,3}$' and (v_item->>'position')::int <= 100 then (v_item->>'position')::smallint else null end;
    if v_kind = 'need' then
      insert into public.project_items (project_id, kind, need, due_date, step, position)
      values (v_id, 'need', v_item->'need', v_due, v_step, v_pos);
    else
      v_ref := (v_item->>'ref_id')::uuid;
      if not public.project_ref_owned(p_client, v_kind, v_ref) then
        raise exception 'project_create: not the client''s own %', v_kind using errcode = '42501';
      end if;
      insert into public.project_items (project_id, kind, ref_id, step, position)
      values (v_id, v_kind, v_ref, v_step, v_pos);
    end if;
  end loop;
  return v_id;
end;
$$;

-- ── 3. project_link_item: a filled need passes on its step and place ────────
create or replace function public.project_link_item(p_project uuid, p_client uuid, p_kind text, p_ref uuid, p_replaces uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item uuid;
  v_other uuid;
  v_step text;
  v_pos smallint;
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
  if p_replaces is not null then
    select step, position into v_step, v_pos from public.project_items where id = p_replaces and project_id = p_project and kind = 'need';
  end if;
  if v_item is null then
    insert into public.project_items (project_id, kind, ref_id, step, position) values (p_project, p_kind, p_ref, v_step, v_pos) returning id into v_item;
  end if;
  if p_replaces is not null then
    delete from public.project_items where id = p_replaces and project_id = p_project and kind = 'need';
  end if;
  update public.projects set updated_at = now() where id = p_project;
  return v_item;
end;
$$;

-- ── 4. Move a plan to a new date ────────────────────────────────────────────
-- Returns true when the client's open plan was moved. Shifts only the due
-- dates of needs (parts not booked yet); bookings and requests keep their
-- own dates, which only a person changes.
create or replace function public.project_move_date(p_project uuid, p_client uuid, p_date date, p_date_end date, p_label text, p_shift_days integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_brief jsonb;
begin
  if p_date is null or (p_date_end is not null and p_date_end < p_date) then
    raise exception 'project_move_date: bad dates' using errcode = '22023';
  end if;
  if p_shift_days is not null and abs(p_shift_days) > 365 then
    raise exception 'project_move_date: shift too large' using errcode = '22023';
  end if;
  select brief into v_brief from public.projects where id = p_project and client_id = p_client and status = 'open' for update;
  if not found then
    return false;
  end if;
  v_brief := coalesce(v_brief, '{}'::jsonb)
    || jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'date_label', left(coalesce(p_label, ''), 60))
    || jsonb_build_object('date_end', case when p_date_end is null then null else to_char(p_date_end, 'YYYY-MM-DD') end);
  update public.projects set brief = v_brief, updated_at = now() where id = p_project;
  if coalesce(p_shift_days, 0) <> 0 then
    update public.project_items set due_date = due_date + p_shift_days
     where project_id = p_project and kind = 'need' and due_date is not null;
  end if;
  return true;
end;
$$;

revoke all on function public.project_create(uuid, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.project_link_item(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.project_move_date(uuid, uuid, date, date, text, integer) from public, anon, authenticated;
grant execute on function public.project_create(uuid, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.project_link_item(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.project_move_date(uuid, uuid, date, date, text, integer) to service_role;

-- ── 5. agent_actions: moving a plan is a proposal too ───────────────────────
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.agent_actions'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.agent_actions drop constraint %I', v_name);
  end loop;
  alter table public.agent_actions add constraint agent_actions_kind_check
    check (kind in ('gear_booking', 'service_booking', 'project_create', 'project_update'));
end $$;

commit;

notify pgrst, 'reload schema';
