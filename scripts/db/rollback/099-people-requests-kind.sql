-- Rollback for lib/migrations/099-people-requests-kind.sql. Drops "Ask
-- everyone" proposals (prepared or done; the People requests they sent stay,
-- they are the client's own requests) and puts back the 098 kind check.
-- No booking, request or payment is touched.
-- Not in lib/migrations on purpose.

begin;

delete from public.agent_actions where kind = 'people_requests';
alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check
  check (kind in ('gear_booking', 'service_booking', 'project_create', 'project_update'));

commit;

notify pgrst, 'reload schema';
