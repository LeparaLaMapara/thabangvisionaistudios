-- 099 test: "Ask everyone" (people_requests) is a valid approval kind, every
-- earlier kind still is, an unknown kind is still refused, and exactly one
-- kind check remains. One transaction, rolled back. Raises on the first
-- failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/099-people-requests-kind.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000990a1', 't099-client@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000990a1') on conflict (id) do nothing;

do $$
declare
  client uuid := '00000000-0000-4000-8000-0000000990a1';
  k text;
begin
  -- Every kind the app knows is accepted, including the new one
  foreach k in array array['gear_booking', 'service_booking', 'project_create', 'project_update', 'people_requests'] loop
    insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
    values (gen_random_uuid(), client, k, 0, '{}', '{}', 'x', now() + interval '15 minutes');
  end loop;

  -- An unknown kind is still refused
  begin
    insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
    values (gen_random_uuid(), client, 'people_book', 0, '{}', '{}', 'x', now() + interval '15 minutes');
    raise exception 'FAIL 1: an unknown action kind was accepted';
  exception when check_violation then null;
  end;

  -- Exactly one kind check remains (found by definition, re-added once)
  if (select count(*) from pg_constraint
       where conrelid = 'public.agent_actions'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%kind%') <> 1 then
    raise exception 'FAIL 2: expected exactly one kind check on agent_actions';
  end if;
end $$;

rollback;
