-- 095: the People request loop.
--
-- A People request used to be saved and then reach nobody. Now the owner,
-- the person asked and the client are emailed, the owner sees requests on
-- Today, and staff answer them (app/api/admin/roles/requests):
--
--   requested -> accepted   the person can do it; we send the client how to pay
--   requested -> declined   not going ahead; the client is told
--   accepted  -> confirmed  the client paid (marked by staff: payment for People
--                           is taken by hand until online payment is built)
--
-- 1. role_booking_requests.status gains 'accepted' (date agreed, not paid).
--    Faces and names are still revealed only on 'confirmed' (lib/roles/reveal.ts).
-- 2. responded_at, responded_by and client_note: when staff answered, who,
--    and the short note the client sees on a decline.
-- 3. Notification types for the in-app bell: people_request (to the person
--    asked), people_request_update (to the client and the person) and
--    people_profile_update (approved or sent back, to the person offering).
--
-- Safe to run more than once. Apply by hand to dev, then prod, after 094.

begin;

do $$
begin
  if to_regclass('public.role_booking_requests') is null then
    return;  -- People (091) is not on this database
  end if;

  alter table public.role_booking_requests drop constraint if exists role_booking_requests_status_check;
  alter table public.role_booking_requests add constraint role_booking_requests_status_check
    check (status in ('requested', 'accepted', 'confirmed', 'withdrawn', 'declined', 'completed'));

  alter table public.role_booking_requests add column if not exists responded_at timestamptz;
  alter table public.role_booking_requests add column if not exists responded_by uuid references auth.users(id) on delete set null;
  alter table public.role_booking_requests add column if not exists client_note text;
  if not exists (select 1 from pg_constraint where conrelid = 'public.role_booking_requests'::regclass and conname = 'role_booking_requests_client_note_check') then
    alter table public.role_booking_requests add constraint role_booking_requests_client_note_check
      check (client_note is null or length(client_note) <= 500);
  end if;

  create index if not exists idx_role_booking_requests_status on public.role_booking_requests (status, created_at);
end $$;

do $$
declare
  def text;
  current_types text[];
  wanted text[] := array['people_request', 'people_request_update', 'people_profile_update'];
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

  -- The list reads as ARRAY['a'::text, ...] or as '{a,b}'::text[]
  -- (after 082 it is the second); both are split into single types here.
  select coalesce(array_agg(distinct trim(both '"' from x)), '{}') into current_types
    from regexp_matches(def, '''([^'']+)''', 'g') as m,
         unnest(string_to_array(trim(both '{}' from m[1]), ',')) as x;

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

notify pgrst, 'reload schema';

commit;
