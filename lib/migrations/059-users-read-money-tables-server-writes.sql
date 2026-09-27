-- 059: users may read their bookings, subscriptions and usage; only the server writes them.
--
-- Found live on 2026-09-24 and re-checked 2026-09-27:
--   bookings            any signed-in user could INSERT a row with any status,
--                       payment_status and amounts (e.g. "paid", "delivered"),
--                       which the payout path then trusted.
--   equipment_bookings  the owner could INSERT and UPDATE any column: confirm an
--                       unpaid rental, change its price.
--   subscriptions       the owner could INSERT an active plan or UPDATE it.
--   ubunye_usage        the owner could UPDATE (reset) their own AI message count.
--
-- Every write to these tables now happens in API routes with the service role,
-- after the route has checked who the user is and that the record is theirs
-- (PR #27, 2026-09-27). SELECT policies and admin ALL policies stay, so people
-- still see their own records and admins keep managing them.
--
-- Policy names differ between the dev and production projects, so this drops
-- every INSERT and UPDATE policy on the four tables rather than naming them.
-- Apply on the dev project first, then production.

begin;

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('bookings', 'equipment_bookings', 'subscriptions', 'ubunye_usage')
      and cmd in ('INSERT', 'UPDATE')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    raise notice 'dropped % on %', p.policyname, p.tablename;
  end loop;
end $$;

commit;

-- Production had, before this migration (to recreate if ever needed):
--   bookings            "Authenticated users create bookings"  INSERT  with check (auth.uid() = client_id)
--   equipment_bookings  "Bookings: authenticated insert"       INSERT  with check (user_id = auth.uid())
--   equipment_bookings  "Bookings: owner update"               UPDATE  using (user_id = auth.uid())
--   subscriptions       "Subscriptions: authenticated insert"  INSERT  with check (user_id = auth.uid())
--   subscriptions       "Subscriptions: owner update"          UPDATE  using (user_id = auth.uid())
--   ubunye_usage        "Users can insert own usage"           INSERT  with check (auth.uid() = user_id)
--   ubunye_usage        "Users can update own usage"           UPDATE  using/check (auth.uid() = user_id)
