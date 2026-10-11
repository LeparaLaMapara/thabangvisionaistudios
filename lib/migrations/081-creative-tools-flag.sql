-- 081: feature flag `creative_tools` (off).
--
-- Shows "Tools" (Ubunye Creative Studio, /tools) in the main navigation.
-- The /tools pages are reachable by URL whether or not the flag is on; the
-- flag only controls the nav entry. Turn it on from /admin/flags.
--
-- Safe to run more than once. Apply by hand to dev and prod.

begin;

do $$
begin
  if to_regclass('public.feature_flags') is not null then
    insert into public.feature_flags (key, enabled, description)
    values ('creative_tools', false, 'Ubunye Creative Studio: show "Tools" (/tools) in the main navigation.')
    on conflict (key) do nothing;
  end if;
end $$;

commit;
