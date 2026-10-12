-- 082 test: the two ID check notification types are accepted, earlier types
-- still are, and an unknown type is still refused. One transaction, rolled back.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/082-verification-notifications.test.sql

begin;

do $$
declare
  u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (u, 't082-' || u || '@example.invalid');

  insert into public.notifications (user_id, type, title, body)
  values (u, 'verification_approved', 'ID checked', 't082'),
         (u, 'verification_rejected', 'ID not accepted', 't082'),
         (u, 'dispute_updated', 'still allowed', 't082');
  raise notice 'PASS 082: verification_approved, verification_rejected and an older type are accepted';

  begin
    insert into public.notifications (user_id, type, title, body) values (u, 't082_not_a_type', 'x', 'x');
    raise exception 'FAIL 082: an unknown notification type was accepted';
  exception when check_violation then
    raise notice 'PASS 082: an unknown type is still refused';
  end;
end $$;

select 'ALL 082 CHECKS PASSED' as result;

rollback;
