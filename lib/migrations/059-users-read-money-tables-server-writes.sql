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
-- (PR "Money writes on the server", 2026-09-27). The SELECT policies stay, so
-- people still see their own bookings. Admin policies stay.
--
-- Apply on the dev project first, then production. Reversible: see the end.

begin;

drop policy if exists "Authenticated users create bookings" on public.bookings;

drop policy if exists "Bookings: authenticated insert" on public.equipment_bookings;
drop policy if exists "Bookings: owner update" on public.equipment_bookings;

drop policy if exists "Subscriptions: authenticated insert" on public.subscriptions;
drop policy if exists "Subscriptions: owner update" on public.subscriptions;

drop policy if exists "Users can insert own usage" on public.ubunye_usage;
drop policy if exists "Users can update own usage" on public.ubunye_usage;

commit;

-- To undo (only if a route that still writes with the user's session breaks):
--   create policy "Authenticated users create bookings" on public.bookings
--     for insert to public with check (auth.uid() = client_id);
--   create policy "Bookings: authenticated insert" on public.equipment_bookings
--     for insert to authenticated with check (user_id = auth.uid());
--   create policy "Bookings: owner update" on public.equipment_bookings
--     for update to authenticated using (user_id = auth.uid());
--   create policy "Subscriptions: authenticated insert" on public.subscriptions
--     for insert to authenticated with check (user_id = auth.uid());
--   create policy "Subscriptions: owner update" on public.subscriptions
--     for update to authenticated using (user_id = auth.uid());
--   create policy "Users can insert own usage" on public.ubunye_usage
--     for insert to public with check (auth.uid() = user_id);
--   create policy "Users can update own usage" on public.ubunye_usage
--     for update to public using (auth.uid() = user_id) with check (auth.uid() = user_id);
