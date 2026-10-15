-- Rollback for lib/migrations/095-people-request-loop.sql. Accepted requests
-- go back to 'requested'; staff answers and decline notes are lost; the three
-- People notification types are removed (their rows are deleted first).
-- Not in lib/migrations on purpose.

begin;

do $$
begin
  if to_regclass('public.role_booking_requests') is not null then
    update public.role_booking_requests set status = 'requested' where status = 'accepted';
    alter table public.role_booking_requests drop constraint if exists role_booking_requests_status_check;
    alter table public.role_booking_requests add constraint role_booking_requests_status_check
      check (status in ('requested', 'confirmed', 'withdrawn', 'declined', 'completed'));
    alter table public.role_booking_requests drop constraint if exists role_booking_requests_client_note_check;
    alter table public.role_booking_requests
      drop column if exists responded_at, drop column if exists responded_by, drop column if exists client_note;
    drop index if exists public.idx_role_booking_requests_status;
  end if;
end $$;

do $$
declare
  def text;
  kept text[];
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if def is null then
    return;
  end if;
  delete from public.notifications where type in ('people_request', 'people_request_update', 'people_profile_update');
  select array_agg(distinct t order by t) into kept
    from (select trim(both '"' from x) as t
            from regexp_matches(def, '''([^'']+)''', 'g') as m,
                 unnest(string_to_array(trim(both '{}' from m[1]), ',')) as x) s
   where t not in ('people_request', 'people_request_update', 'people_profile_update');
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', kept);
end $$;

notify pgrst, 'reload schema';

commit;
