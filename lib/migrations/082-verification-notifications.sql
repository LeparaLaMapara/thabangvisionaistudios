-- 082: notification types for ID check decisions.
--
-- When staff approve or reject someone's ID check, the person is told in the
-- app as well as by email (app/api/admin/verifications/[id]). The types are
-- added to notifications_type_check, keeping every type already allowed.
--
-- Safe to run more than once. Apply by hand to dev, then prod, after 081.

begin;

do $$
declare
  def text;
  current_types text[];
  wanted text[] := array['verification_approved', 'verification_rejected'];
  merged text[];
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.conname = 'notifications_type_check';

  if def is null then
    return;  -- no list enforced, nothing to extend
  end if;

  select coalesce(array_agg(m[1]), '{}') into current_types
    from regexp_matches(def, '''([^'']+)''', 'g') as m;

  if current_types @> wanted then
    return;
  end if;

  select array_agg(t order by t) into merged
    from (select distinct unnest(current_types || wanted) as t) s;

  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))',
    merged
  );
end $$;

commit;
