# ADR 0001: Reservations are decided inside the database, under a row lock

- **Status:** Accepted for Phase 1. The code is in review on `phase-1-gear-pipeline`. Migration 070 is verified only on local PostgreSQL 16 with a Supabase stub. Dev DB applied: NOT RUN.
- **Date:** 2026-10-08

## Context

Before Phase 1, availability was read-then-write in the API route. It counted overlapping bookings, then inserted. Two checkouts for the last unit could both read "1 free" and both insert. Gear that was disputed, being inspected or overdue also stopped blocking stock once its booked dates passed. A multi-item cart could be half-reserved.

## Decision

1. **One definition of "taken"**, in SQL: `rental_units_blocked(rental, start, end)`.
   - It counts `confirmed`, `active`, `overdue`, `return_pending`, `return_reviewed` and `disputed` lines, plus `pending` lines whose hold is still live or that are already paid.
   - Dates are inclusive. The end date counts, so the return day is not resold (D-21).
   - Gear that is not back blocks open-endedly until a person records it back: `overdue`, `return_pending`, `return_reviewed`, `disputed`, or `active` past its end date.
   - Units in `rental_blocks` (maintenance, repair, lost) are subtracted too.
2. **One function reserves an order**: `reserve_rental_order(rows, intent, hold_minutes)`, `SECURITY DEFINER`, service role only. In a single transaction it:
   - locks every listing in the order with `SELECT … FOR UPDATE`, in id order, so two carts cannot deadlock;
   - refuses an order id that already exists (`duplicate_order`, from the `Idempotency-Key`);
   - checks each line against `rental_units_blocked` and stock;
   - inserts all lines and the payment intent. All or none.
3. A late payment is re-checked under the same lock (`confirm_rental_payment` with `late = true`). It never double-books. If the stock is gone, the money is owed back.
4. The app-side availability check (`lib/rental/availability.ts`) remains, but only for friendly messages. It is not the guard.

## Alternatives considered

- **Exclusion constraint** (`EXCLUDE USING gist` on rental + daterange). This handles one unit per listing well. It does not express a stock count above 1, open-ended blocking for unreturned gear, or hold expiry without extra machinery. Rejected for now.
- **Advisory lock per listing.** It works, but is invisible in the schema and easy to bypass from a new code path. Row locks on `smart_rentals` are explicit.
- **Serializable isolation in the route.** It needs retry loops in every caller through PostgREST. Rejected.

## Consequences

- Concurrent checkouts for the same listing queue behind each other for the length of one short transaction.
- Every path that creates gear bookings must go through `reserve_rental_order`. `POST /api/bookings` (the single-item booking endpoint) is retired with 410 for that reason.
- If 070 is missing, checkout falls back to the old read-then-write insert. That fallback has the race, so 070 should be applied before Phase 1 code takes real orders.

## Evidence

- `lib/migrations/070-gear-pipeline.test.sql` (local PostgreSQL only). It checks: overlapping reservation refused; repeated request refused (T06); return day not resold; multi-item all-or-nothing; disputed and overdue gear unavailable (T24, T25); maintenance blocks; late payment never double-books (T11).
- `scripts/db/070-concurrency.sh`. Two real sessions race for the last unit, and exactly one booking results (T07). Passed on local PostgreSQL only.
- Neither has run on the dev Supabase project.
