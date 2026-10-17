-- Rollback for lib/migrations/096-people-request-dedupe.sql. Drops the
-- partial unique index; no data changes. The app still returns an open
-- request on a double submit (app/api/roles/requests), but a race between
-- two submits could make two requests again.
-- Not in lib/migrations on purpose.

begin;

drop index if exists public.role_booking_requests_one_open;

commit;

notify pgrst, 'reload schema';
