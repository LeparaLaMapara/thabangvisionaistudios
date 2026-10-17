-- 096: one open People request per client, person and first day.
--
-- A double submit (two taps, two tabs, a network retry) made two requests
-- for the same person and day, and the person and our team were emailed
-- twice. app/api/roles/requests now returns the open request instead
-- ({ id, existing: true }); this partial unique index holds the line when
-- two submits race past that check. A declined, withdrawn or completed
-- request does not count, so the client can ask again after a decline.
--
-- The statuses match OPEN_REQUEST_STATUSES in lib/roles/request-guards.ts.
--
-- Index only: no data changes. If existing rows already break the rule (two
-- open requests for the same client, person and first day), the create
-- fails and nothing changes; resolve those rows first (decline the extra).
-- Safe to run more than once. Apply by hand to dev, then prod, after 095.
-- Rollback: scripts/db/rollback/096-people-request-dedupe.sql.

begin;

do $$
begin
  if to_regclass('public.role_booking_requests') is null then
    return;  -- People (091) is not on this database
  end if;

  create unique index if not exists role_booking_requests_one_open
    on public.role_booking_requests (client_id, person_role_id, requested_date)
    where status in ('requested', 'accepted', 'confirmed');
end $$;

commit;

notify pgrst, 'reload schema';
