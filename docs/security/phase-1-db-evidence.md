# Phase 1: database evidence (migration 070)

**Status: Dev DB applied: NOT RUN.** On 2026-10-08 applying 070 to DEV (`bprargrqppufeuewryze`) was attempted through the Supabase connector. The call was **cancelled before it executed**. No DEV or PROD database was modified. 070 is **not applied anywhere**.

Nothing here counts as verified on a Supabase project until the founder, or an approved session, applies 070 to DEV and runs both scripts below.

**Supporting evidence only:** the migration and both scripts ran on a throwaway **local** PostgreSQL 16 with a Supabase stub (section 5).

**Prod: no migration.** The founder applies 070 to production after review (section 6).

| Item | Value |
|---|---|
| Migration | `lib/migrations/070-gear-pipeline.sql` |
| Test script | `lib/migrations/070-gear-pipeline.test.sql` (one transaction, ends in `ROLLBACK`) |
| Concurrency script | `scripts/db/070-concurrency.sh` (two sessions; creates and deletes its own fixtures; refuses the production project id) |
| Target project | DEV only (`bprargrqppufeuewryze`). Never production |
| Applied by / date | _TODO_ |
| Test run by / date | _TODO_ |
| Result | _TODO: "ALL 070 CHECKS PASSED" and "PASS: exactly one booking for the last unit (T07)", or the first FAIL line_ |

**Still pending from Phase 0:** 067, 068 and 069 are also not applied to DEV ([phase-0-db-evidence.md](phase-0-db-evidence.md)). Apply them first, in order. 070 does not depend on them, but the Phase 0 tests should pass on the same database before 070 is judged.

## 1. What 070 adds

Additive and re-runnable. In summary:

- New columns on `equipment_bookings`: hold expiry, cancel reason, cents snapshot, ownership, inspection outcome, return evidence, `completed_at`, `requires_manual_approval`.
- Tables: `rental_blocks`, `rental_payment_intents`, `payment_events`, `ledger_journals`/`ledger_lines`, `notification_outbox`, `refund_obligations`, `owner_payouts`, `booking_status_history`, `rental_escalations`.
- Functions: `rental_units_blocked`, `reserve_rental_order`, `claim_payment_events`, `ledger_post`, `outbox_enqueue`, `claim_outbox`, `confirm_rental_payment`, `record_unallocated_payment`, `record_failed_payment_attempt`, `transition_rental_booking`, `refund_transition`, `payout_transition`, `expire_rental_holds`. All are `SECURITY DEFINER` with a pinned `search_path`. `EXECUTE` is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only.
- Triggers: the ledger and status history are append-only, and refunds are capped at the charge.
- RLS on every new table. Clients may read only their own intents, refunds, payouts and booking history. Admins may read blocks.
- `notifications_type_check` is replaced, adding the `rental_*` kinds.

See [ADR 0001](../architecture/adr/0001-database-locked-reservations.md) and [ADR 0002](../architecture/adr/0002-durable-payment-inbox-and-ledger.md).

## 2. Pre-apply checks (DEV, read-only)

```sql
-- 070 replaces this constraint: every existing type must be in its new list.
select distinct type from public.notifications order by 1;

-- Columns 070 reads must exist.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'smart_rentals'
   and column_name in ('quantity', 'deleted_at', 'is_archived', 'is_available', 'replacement_value', 'serial_number');
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'equipment_bookings'
   and column_name in ('payfast_payment_id', 'checkout_group_id', 'payment_method', 'handover', 'return_reviewed_by',
                       'cancellation_refund_status', 'deposit_refund_method', 'dispute_reason');

-- is_admin() is used by the new policies.
select proname from pg_proc where proname = 'is_admin';

-- Pending lines that will get a hold expiry back-filled.
select payment_method, count(*) from public.equipment_bookings where status = 'pending' group by 1;
```

_TODO: paste output._

## 3. Apply and test (DEV)

```
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/070-gear-pipeline.sql
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/070-gear-pipeline.test.sql
DATABASE_URL="$DEV_DATABASE_URL" scripts/db/070-concurrency.sh
```

Then re-apply 070 once more to confirm it is idempotent.

The test script inserts throwaway rows into `auth.users`, `profiles` and `smart_rentals` inside its transaction, and rolls everything back. The concurrency script commits its fixtures and deletes them at the end. If it is interrupted, remove the `race-…` listing and the `race-a/race-b@example.invalid` users by hand.

_TODO: paste the full output._

## 4. Checks and what they prove

| NOTICE text | Proves |
|---|---|
| `reservation created line … and an intent` | Atomic reservation with intent |
| `overlapping reservation refused (insufficient_stock)` | No overbooking (sequential) |
| `repeated checkout request is refused (T06)` | Idempotent order creation |
| `return day is not resold` | Inclusive dates (D-21) |
| `multi-item cart is all-or-nothing` | T07 (no partial orders) |
| `one order = one customer` | Lines cannot be mixed across customers |
| `wrong amount does not confirm` | §7.6 #9 |
| `duplicate webhook confirms once, books once, notifies once (T09, T28)` | T09, T28 |
| `unbalanced journal refused`, `ledger is append-only` | Ledger integrity |
| `disputed and overdue gear stay unavailable (T24, T25)` | T24, T25 |
| `maintenance blocks take units off sale until lifted` | `rental_blocks` |
| `late payment never double-books (T11)` | T11 |
| `one refund obligation per late payment, replay-safe` | T13 |
| `refunds cannot exceed the charge (T13, T14)` | T14 cap trigger |
| `only one worker can claim a refund` | Compare-and-set claim |
| `transitions are guarded, idempotent and recorded (T06)` | State machine in SQL plus history |
| `one payout per booking (T16)` | T16 |
| `clients cannot execute money RPCs`, `clients cannot write refund obligations` | Grants |
| `a stranger sees no payment intents (T27)` | RLS |
| `concurrency.sh`: `PASS: exactly one booking for the last unit (T07)` | Two-session race under the row lock |

## 5. Local rehearsal (not a Supabase project)

Run on a throwaway local PostgreSQL 16 with a minimal Supabase stub (Supabase roles, `auth.uid()` from `request.jwt.claims`, and the tables 070 reads), in the same style as the Phase 0 rehearsal.

- 070 applied.
- `070-gear-pipeline.test.sql` finished with `ALL 070 CHECKS PASSED`. Every check in section 4 printed PASS.
- `070-concurrency.sh` printed `PASS: exactly one booking for the last unit (T07)`.

This does **not** replace the DEV run. It cannot reproduce Supabase's real grants, PostgREST's schema cache, or any dev/prod column drift.

## 6. Deploy order

**Recommended: apply 070, then deploy the Phase 1 code.**

Strictly, 070 does not have to come first. Every Phase 1 adapter detects a missing table or function (`isMissingPipeline`) and falls back to the pre-Phase-1 path, so the code can be deployed before 070 without breaking the site. While it runs that way, though, none of the Phase 1 guarantees hold: the checkout race is still open, there is no inbox, no obligations and no ledger. So apply 070 first.

Order on each environment:

1. 067 → 068 → 069 (Phase 0, still pending).
2. 070, then its test scripts (DEV only).
3. Deploy the Phase 1 code.
4. Run Rental ops → **Run pipeline** once, and check the invariant sweep the next morning.

After 070, `PostgREST` may need its schema cache reloaded before the new functions are callable (`notify pgrst, 'reload schema';`). Until then the code keeps using the fallback.

## 7. Rollback

See the commented ROLLBACK section at the end of the migration. It is safe only **before any real money has moved through these tables**. After that, the tables are the financial record and must not be dropped.
