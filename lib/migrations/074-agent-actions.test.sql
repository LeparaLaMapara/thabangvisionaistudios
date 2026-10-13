-- 074 test script. One transaction, ends in ROLLBACK.
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/074-agent-actions.test.sql
begin;

do $$
declare
  u uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  n integer;
begin
  insert into auth.users (id, email) values (u, 'p2-074-' || u || '@example.invalid');
  insert into public.agent_actions (id, user_id, conversation_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
  values (a1, u, c, 'gear_booking', 450000, '{}', '{}', 'h1', now() + interval '15 minutes');
  insert into public.agent_actions (id, user_id, conversation_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
  values (a2, u, c, 'gear_booking', 300000, '{}', '{}', 'h2', now() + interval '15 minutes');
  if (select state from public.agent_actions where id = a1) <> 'superseded' then raise exception 'FAIL: older proposal not superseded'; end if;
  if (select state from public.agent_actions where id = a2) <> 'prepared' then raise exception 'FAIL: new proposal not pending'; end if;
  raise notice 'PASS: a new proposal supersedes the older one in the same conversation';

  -- The commit claim is a compare-and-set: only one of two attempts wins.
  update public.agent_actions set state = 'committing' where id = a2 and state = 'prepared' and nonce_hash = 'h2' and expires_at > now();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: first claim refused'; end if;
  update public.agent_actions set state = 'committing' where id = a2 and state = 'prepared' and nonce_hash = 'h2' and expires_at > now();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a second claim succeeded (replay)'; end if;
  raise notice 'PASS: an approval can be used once';

end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
    values (gen_random_uuid(), gen_random_uuid(), 'gear_booking', 1, '{}', '{}', 'x', now());
    raise exception 'FAIL: a client inserted an agent action';
  exception when insufficient_privilege then
    raise notice 'PASS: clients cannot create or approve proposals directly';
  end;
  if exists (select 1 from public.agent_actions) then raise exception 'FAIL: a stranger can read proposals'; end if;
  raise notice 'PASS: a stranger sees no proposals';
end $$;
reset role;

rollback;
select 'ALL 074 CHECKS PASSED' as result;
