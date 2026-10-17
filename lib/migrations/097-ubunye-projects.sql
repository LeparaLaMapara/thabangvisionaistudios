-- 097: Ubunye plans (projects) and chat cards that survive a reload.
--
-- WHY
--   A customer outcome that needs more than one part ("a videographer,
--   lights and an editor for my music video") had nowhere to live: each part
--   is its own booking or request, and a need we cannot fill yet (an editor
--   is coming soon) was forgotten when the chat closed. A plan is only made
--   when coordination is needed (two or more parts, or a need that must be
--   remembered); one photographer never makes a plan.
--   Separately, the chat lost its People cards and approval cards on reload,
--   because only the reply text was kept.
--
-- WHAT
--   1. projects: one row per plan. The client, a title, the brief exactly as
--      the client said it (outcome, place, date or window, budget_cents; size
--      capped), open or closed, and the chat it came from.
--   2. project_items: what the plan points at. REFERENCES ONLY: a gear order
--      (equipment_bookings.checkout_group_id), a People request
--      (role_booking_requests.id), a service booking (bookings.id), or a need
--      we cannot fill or have not asked for yet (need jsonb, size capped).
--      Status, price and dates are always read live from the referenced
--      table, never copied here. One booking belongs to at most one plan.
--   3. project_ref_owned / project_create / project_link_item: server-only
--      functions (service role) that refuse a reference that is not the
--      client's own, and create a plan with its parts in one transaction.
--   4. agent_actions.kind gains 'project_create': a plan is a Ubunye
--      proposal like any other, approved by the client on the chat card
--      before anything is written (074).
--   5. chat_messages.cards (blind card data: People results, proposal ids)
--      and chat_messages.tool_ref_ids (ids our tools returned in that turn,
--      so a later plan may only point at ids a tool really returned).
--   6. feature_flags row 'ubunye_projects', OFF. It stays off on production
--      until the owner switches it on.
--
-- SAFETY
--   Additive; no money table, payment code or reserve function changes (no
--   foreign key to money tables). RLS on both tables: a client reads only
--   their own plans; anon and authenticated may not write; the server writes
--   with the service role after its own ownership check, and the functions
--   check ownership again. One transaction, safe to run more than once.
--   Needs 074 (agent_actions), 091/095 (role_booking_requests).
--   Test: lib/migrations/097-ubunye-projects.test.sql.
--   Rollback: scripts/db/rollback/097-ubunye-projects.sql.

begin;

-- ── 1. projects ─────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  brief jsonb not null default '{}'::jsonb
    check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) <= 2048),
  status text not null default 'open' check (status in ('open', 'closed')),
  source_conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_projects_client on public.projects (client_id, created_at desc);

-- ── 2. project_items ────────────────────────────────────────────────────────
create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('gear_order', 'people_request', 'service_booking', 'need')),
  -- gear_order: equipment_bookings.checkout_group_id; people_request:
  -- role_booking_requests.id; service_booking: bookings.id. Polymorphic by
  -- design: no foreign key into the money tables.
  ref_id uuid,
  need jsonb check (need is null or (jsonb_typeof(need) = 'object' and pg_column_size(need) <= 1024)),
  created_at timestamptz not null default now(),
  constraint project_items_need_xor_ref check (
    (kind = 'need' and ref_id is null and need is not null)
    or (kind <> 'need' and ref_id is not null and need is null)
  ),
  constraint project_items_one_plan unique (kind, ref_id)
);

create index if not exists idx_project_items_project on public.project_items (project_id, created_at);

-- ── RLS: the client reads their own; nobody but the server writes ──────────
alter table public.projects enable row level security;
alter table public.project_items enable row level security;

drop policy if exists "Own projects" on public.projects;
create policy "Own projects" on public.projects for select to authenticated
  using (client_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Own project items" on public.project_items;
create policy "Own project items" on public.project_items for select to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = project_items.project_id
       and (p.client_id = (select auth.uid()) or (select public.is_admin()))
  ));

revoke all on public.projects from public, anon, authenticated;
revoke all on public.project_items from public, anon, authenticated;
grant select on public.projects to authenticated;
grant select on public.project_items to authenticated;
grant all on public.projects to service_role;
grant all on public.project_items to service_role;

-- ── 3. Server-only functions ────────────────────────────────────────────────
-- Whether a referenced record is this client's own. Fails closed: an unknown
-- kind or a missing record is false. A gear order is theirs only when every
-- line of the order is theirs.
create or replace function public.project_ref_owned(p_client uuid, p_kind text, p_ref uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_client is null or p_ref is null then
    return false;
  end if;
  if p_kind = 'people_request' then
    return exists (select 1 from public.role_booking_requests r where r.id = p_ref and r.client_id = p_client);
  elsif p_kind = 'gear_order' then
    return exists (select 1 from public.equipment_bookings e where e.checkout_group_id = p_ref and e.user_id = p_client)
       and not exists (select 1 from public.equipment_bookings e where e.checkout_group_id = p_ref and e.user_id is distinct from p_client);
  elsif p_kind = 'service_booking' then
    return exists (select 1 from public.bookings b where b.id = p_ref and b.client_id = p_client);
  end if;
  return false;
end;
$$;

-- A plan and its parts, all or nothing. p_items: [{"kind": "...", "ref_id": "..."} | {"kind": "need", "need": {...}}].
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

-- Attach the client's own booking or request to their open plan; optionally
-- replace the need it fills. Returns the item id. Already in this plan: the
-- same item back. In another plan: refused (one booking, one plan).
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

revoke all on function public.project_ref_owned(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.project_create(uuid, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.project_link_item(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_ref_owned(uuid, text, uuid) to service_role;
grant execute on function public.project_create(uuid, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.project_link_item(uuid, uuid, text, uuid, uuid) to service_role;

-- ── 4. agent_actions: a plan is a proposal too ──────────────────────────────
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
    check (kind in ('gear_booking', 'service_booking', 'project_create'));
end $$;

-- ── 5. chat_messages: blind cards and the ids tools returned ────────────────
alter table public.chat_messages add column if not exists cards jsonb;
alter table public.chat_messages add column if not exists tool_ref_ids uuid[];
alter table public.chat_messages drop constraint if exists chat_messages_cards_size;
alter table public.chat_messages add constraint chat_messages_cards_size
  check (cards is null or (jsonb_typeof(cards) = 'array' and pg_column_size(cards) <= 32768));
alter table public.chat_messages drop constraint if exists chat_messages_tool_ref_ids_size;
alter table public.chat_messages add constraint chat_messages_tool_ref_ids_size
  check (tool_ref_ids is null or cardinality(tool_ref_ids) <= 200);

-- ── 6. The switch, off ──────────────────────────────────────────────────────
insert into public.feature_flags (key, enabled, description)
values ('ubunye_projects', false, 'Ubunye plans: a multi-part outcome saved as a plan the client approves, at /dashboard/plans. Off until the owner switches it on.')
on conflict (key) do nothing;

commit;

notify pgrst, 'reload schema';
