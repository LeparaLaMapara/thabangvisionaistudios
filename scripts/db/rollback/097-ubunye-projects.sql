-- Rollback for lib/migrations/097-ubunye-projects.sql. Drops the plans
-- (projects, project_items and their functions), the plan proposals in
-- agent_actions, the chat card columns and the ubunye_projects flag.
-- Plans are references only, so no booking, request or payment is touched:
-- every booking and request stays exactly as it is.
-- Not in lib/migrations on purpose.

begin;

drop function if exists public.project_link_item(uuid, uuid, text, uuid, uuid);
drop function if exists public.project_create(uuid, text, jsonb, uuid, jsonb);
drop function if exists public.project_ref_owned(uuid, text, uuid);
drop table if exists public.project_items;
drop table if exists public.projects;

delete from public.agent_actions where kind = 'project_create';
alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check
  check (kind in ('gear_booking', 'service_booking'));

alter table public.chat_messages drop constraint if exists chat_messages_cards_size;
alter table public.chat_messages drop constraint if exists chat_messages_tool_ref_ids_size;
alter table public.chat_messages drop column if exists cards;
alter table public.chat_messages drop column if exists tool_ref_ids;

delete from public.feature_flags where key = 'ubunye_projects';

commit;

notify pgrst, 'reload schema';
