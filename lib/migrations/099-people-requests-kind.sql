-- 099: "Ask everyone" is an approved proposal (agent_actions.kind people_requests)
--
-- WHAT
--   agent_actions.kind gains 'people_requests': the client sees their whole
--   shoot in Ubunye, taps once to ask every chosen person, and the approval
--   commit sends each People request through the same rules as the request
--   form (lib/roles/request-send.ts). Like a plan (097) and a plan move
--   (098), it is prepared by the model and committed only when the signed-in
--   client presses the button on the approval card (074).
--
-- SAFETY
--   Constraint only. It costs nothing (amount_cents 0): a request is not a
--   booking and nothing is paid by approving. No money table, payment code,
--   reserve function or request row changes. The kind check is found by its
--   definition (production's and dev's names both work) and re-added with
--   every kind. One transaction, safe to run more than once.
--   Needs 074 (agent_actions) and 098 (project_update).
--
--   Rollback: scripts/db/rollback/099-people-requests-kind.sql.

begin;

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
    check (kind in ('gear_booking', 'service_booking', 'project_create', 'project_update', 'people_requests'));
end $$;

commit;

notify pgrst, 'reload schema';
