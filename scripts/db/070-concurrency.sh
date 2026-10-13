#!/usr/bin/env bash
# T07: two customers race for the last unit at the same moment.
#
# Session A reserves the unit and holds its transaction open for 2 seconds.
# Session B tries the same unit 0.5 s later. With reserve_rental_order's row
# lock, B waits for A, then sees A's booking and is refused. Without the lock
# both would have read "1 free" and both would have booked.
#
# Usage: DATABASE_URL=postgres://... scripts/db/070-concurrency.sh
# Use a local or DEV database only. Fixtures are created and then deleted.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL (local or dev only)}"
case "$DATABASE_URL" in *zbdsqvpxpsygbuqnuekm*) echo "refusing to run against production"; exit 2;; esac

uuid() { cat /proc/sys/kernel/random/uuid; }
U1=$(uuid); U2=$(uuid); CAM=$(uuid); G1=$(uuid); G2=$(uuid)
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('$U1', 'race-a@example.invalid'), ('$U2', 'race-b@example.invalid');
insert into public.profiles (id) values ('$U1'), ('$U2') on conflict (id) do nothing;
insert into public.smart_rentals (id, slug, title, quantity, is_published, category) values ('$CAM', 'race-$CAM', 'Race camera', 1, true, 'cameras-optics');
SQL

line() { echo "jsonb_build_array(jsonb_build_object('user_id','$1','rental_id','$CAM','checkout_group_id','$2','start_date','2031-05-01','end_date','2031-05-03','total_price',1,'deposit_amount',0,'quantity',1))"; }

( psql "$DATABASE_URL" -q -At -v ON_ERROR_STOP=1 -c "begin; select 'A reserved ' || (public.reserve_rental_order($(line "$U1" "$G1"), null, 30) ->> 'booking_ids'); select pg_sleep(2); commit;" 2>&1 | sed 's/^/[A] /' ) &
sleep 0.5
( psql "$DATABASE_URL" -q -At -c "select 'B reserved ' || (public.reserve_rental_order($(line "$U2" "$G2"), null, 30) ->> 'booking_ids');" 2>&1 | sed 's/^/[B] /' ) &
wait

COUNT=$(psql "$DATABASE_URL" -At -c "select count(*) from public.equipment_bookings where rental_id = '$CAM'")
psql "$DATABASE_URL" -q -c "delete from public.booking_status_history where booking_id in (select id from public.equipment_bookings where rental_id = '$CAM'); delete from public.equipment_bookings where rental_id = '$CAM'; delete from public.smart_rentals where id = '$CAM'; delete from public.profiles where id in ('$U1','$U2'); delete from auth.users where id in ('$U1','$U2');" >/dev/null
if [ "$COUNT" = "1" ]; then echo "PASS: exactly one booking for the last unit (T07)"; else echo "FAIL: $COUNT bookings for one unit"; exit 1; fi
