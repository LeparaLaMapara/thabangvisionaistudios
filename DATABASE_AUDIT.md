# Database Audit Report

**Generated:** 2026-03-21
**Database:** Supabase (zbdsqvpxpsygbuqnuekm)
**Method:** OpenAPI spec + migration file analysis + codebase cross-reference

> **Note:** RLS policies and indexes are derived from migration files. Tables created before the migration system (profiles, smart_productions, smart_rentals, press, careers, equipment_bookings, booking_payments, invoices, listings, orders, reviews, subscription_plans, subscriptions) may have additional RLS/indexes configured directly in the Supabase dashboard that are NOT captured here. A `supabase db dump` with access token is needed for a definitive RLS audit.

---

## Tables Summary

| Table | Rows | Columns | RLS (from migrations) | Indexes (from migrations) | Used in Code |
|---|---|---|---|---|---|
| banking_details | 1 | 11 | YES (3 policies) | 0 | YES |
| booking_payments | 4 | 7 | **UNKNOWN** | 0 | YES |
| bookings | 0 | 36 | YES (3 policies) | 4 | YES |
| careers | 1 | 12 | **UNKNOWN** | 0 | YES |
| cart_items | 2 | 5 | YES (4 policies) | 1 | YES |
| contact_messages | 0 | 7 | **UNKNOWN** | 0 | **NO** |
| content_embeddings | 0 | 7 | **UNKNOWN** | 2 | YES (RAG) |
| crew_requests | 2 | 23 | YES (3 policies) | 1 | YES |
| crew_reviews | 0 | 9 | YES (3 policies) | 0 | YES (read) |
| equipment_bookings | 4 | 15 | **UNKNOWN** | 1 | YES |
| invoices | 0 | 8 | **UNKNOWN** | 0 | YES |
| listings | 1 | 23 | **UNKNOWN** | 0 | YES |
| notifications | 0 | 8 | YES (2 policies) | 2 | YES |
| orders | 0 | 13 | **UNKNOWN** | 0 | YES |
| press | 1 | 16 | **UNKNOWN** | 0 | YES |
| profiles | 9 | 47 | **UNKNOWN** | 3 | YES |
| rental_reviews | 0 | 6 | **UNKNOWN** | 1 | YES (read) |
| reviews | 0 | 8 | **UNKNOWN** | 0 | YES (read) |
| smart_crew_members | 0 | 4 | YES (2 policies) | 0 | **NO** |
| smart_crews | 0 | 10 | YES (2 policies) | 0 | **NO** |
| smart_productions | 1 | 22 | **UNKNOWN** | 1 | YES |
| smart_rentals | 21 | 37 | **UNKNOWN** | 2 | YES |
| subscription_plans | 0 | 11 | **UNKNOWN** | 0 | YES |
| subscriptions | 0 | 9 | **UNKNOWN** | 0 | YES |

**Total: 24 tables, 363 columns**

---

## Storage Buckets

| Bucket | Public | Used in Code | Policies (from migrations) |
|---|---|---|---|
| verifications | false | YES (verification uploads) | 3 (insert/update/select for own docs) |
| bug-screenshots | false | **NO** | 0 |

---

## Functions & Triggers

| Name | Type | Source |
|---|---|---|
| `match_content(vector, float, int, text[])` | Function | 001-pgvector (RAG similarity search) |
| `handle_new_user()` | Function + Trigger | 006 (auto-creates profile on auth.users insert) |
| `is_admin()` | Function | 016 (checks JWT app_metadata.role = 'admin') |
| `on_auth_user_created` | Trigger on auth.users | 006 (fires handle_new_user) |

---

## Dead Tables (exist in DB, not used in code)

| Table | Rows | Created In | Reason |
|---|---|---|---|
| **contact_messages** | 0 | Initial setup | Contact form sends via Resend email API only; never writes to DB |
| **smart_crews** | 0 | 007-crew-system.sql | Crew packages feature was superseded by individual creator profiles |
| **smart_crew_members** | 0 | 007-crew-system.sql | Join table for smart_crews — also unused |

**Recommendation:** Drop all three after confirming no future plans.

---

## Dead Columns (exist in table, not queried anywhere in code)

### profiles (47 columns — 1 dead)
| Column | Type | Reason |
|---|---|---|
| `embedding` | vector(1536) | RAG embeddings go to `content_embeddings` table, not directly on profiles |

### smart_rentals (37 columns — 1 dead)
| Column | Type | Reason |
|---|---|---|
| `embedding` | vector(1536) | Same as above — embeddings stored in `content_embeddings` |

### smart_productions (22 columns — 1 dead)
| Column | Type | Reason |
|---|---|---|
| `embedding` | vector(1536) | Same as above |

### press (16 columns — 1 dead)
| Column | Type | Reason |
|---|---|---|
| `embedding` | vector(1536) | Same as above |

### careers (12 columns — 1 dead)
| Column | Type | Reason |
|---|---|---|
| `embedding` | vector(1536) | Same as above |

> **Note on `embedding` columns:** These were created for direct vector search on each table before the centralized `content_embeddings` approach was adopted. The RAG indexer (`lib/rag/indexer.ts`) writes to `content_embeddings`, NOT to the per-table embedding columns. All 5 are dead.

### contact_messages (entire table is dead — see above)

---

## Missing Indexes (foreign keys without indexes)

These FK columns have NO index, which can cause slow JOINs and cascading delete scans:

| Table | Column | References | Impact |
|---|---|---|---|
| **booking_payments** | booking_id | equipment_bookings.id | Slow payment lookups by booking |
| **cart_items** | rental_id | smart_rentals.id | Slow cart filtering by rental |
| **crew_requests** | creator_id | profiles.id | Slow creator request lookups |
| **crew_reviews** | request_id | crew_requests.id | Low impact (0 rows) |
| **crew_reviews** | creator_id | profiles.id | Low impact (0 rows) |
| **equipment_bookings** | user_id | profiles.id | Slow user booking lookups |
| **equipment_bookings** | rental_id | smart_rentals.id | Slow availability checks |
| **invoices** | booking_id | equipment_bookings.id | Low impact (0 rows) |
| **listings** | user_id | profiles.id | Slow user listing lookups |
| **orders** | buyer_id | profiles.id | Slow buyer order lookups |
| **orders** | seller_id | profiles.id | Slow seller order lookups |
| **orders** | listing_id | listings.id | Slow order-by-listing lookups |
| **reviews** | order_id | orders.id | Low impact (0 rows) |
| **reviews** | reviewer_id | profiles.id | Low impact (0 rows) |
| **reviews** | reviewee_id | profiles.id | Low impact (0 rows) |
| **smart_crew_members** | crew_id | smart_crews.id | Dead table |
| **smart_crew_members** | profile_id | profiles.id | Dead table |
| **smart_rentals** | owner_id | profiles.id | Slow owner listing lookups |
| **subscriptions** | user_id | profiles.id | Slow subscription lookups |
| **subscriptions** | plan_id | subscription_plans.id | Slow plan subscription lookups |

**High priority (active tables with data):** booking_payments.booking_id, equipment_bookings.user_id, equipment_bookings.rental_id, crew_requests.creator_id, smart_rentals.owner_id, listings.user_id

---

## Tables Potentially Missing RLS Policies

These tables have no RLS `ENABLE` or `CREATE POLICY` in any migration file. They may have policies set up via the Supabase dashboard — **verify manually**:

| Table | Rows | Sensitivity | Risk |
|---|---|---|---|
| **profiles** | 9 | HIGH (PII, verification data) | Must have RLS |
| **equipment_bookings** | 4 | HIGH (user bookings, payment IDs) | Must have RLS |
| **booking_payments** | 4 | HIGH (payment amounts, status) | Must have RLS |
| **smart_rentals** | 21 | MEDIUM (mostly public data) | Should have RLS |
| **smart_productions** | 1 | LOW (public content) | Should have RLS |
| **press** | 1 | LOW (public content) | Should have RLS |
| **careers** | 1 | LOW (public content) | Should have RLS |
| **listings** | 1 | MEDIUM (user content) | Should have RLS |
| **orders** | 0 | HIGH (buyer/seller, amounts) | Must have RLS |
| **invoices** | 0 | HIGH (financial data) | Must have RLS |
| **reviews** | 0 | LOW | Should have RLS |
| **rental_reviews** | 0 | LOW | Should have RLS |
| **subscription_plans** | 0 | LOW (public data) | Should have RLS |
| **subscriptions** | 0 | HIGH (user subscriptions) | Must have RLS |
| **content_embeddings** | 0 | LOW (vector data) | Optional |
| **contact_messages** | 0 | MEDIUM (emails, messages) | Should have RLS (or drop table) |

> **CRITICAL:** If profiles, equipment_bookings, booking_payments, orders, invoices, and subscriptions don't have RLS enabled, ANY authenticated user with the anon key could read all records via PostgREST. API routes use the service role key, but client-side code (BookingWidget, dashboard pages) uses the anon key and could be exploited.

---

## Redundancies

### 1. Three separate review tables
| Table | For | Rows | Written by Code |
|---|---|---|---|
| reviews | Marketplace orders | 0 | Not written anywhere |
| crew_reviews | Crew requests | 0 | Not written anywhere |
| rental_reviews | Equipment rentals | 0 | Not written anywhere |

All three are read-only in code and have 0 rows. `bookings.client_rating` and `bookings.client_review` also store review data directly on the booking. Consider consolidating into a single polymorphic `reviews` table or removing the unused ones.

### 2. bookings.client_rating/client_review vs reviews table
The `bookings` table has inline review columns (`client_rating`, `client_review`) used by `/api/service-bookings/[id]/review`. The `reviews` table is never written to. This is a redundancy — reviews live on `bookings` directly.

### 3. equipment_bookings vs bookings
Two separate booking tables:
- `equipment_bookings` (15 cols) — for equipment rental bookings
- `bookings` (36 cols) — for service/crew bookings

These serve different purposes (equipment vs services) but could potentially be unified with a `booking_type` discriminator (which `bookings` already has). Currently both are actively used.

### 4. crew_requests.total_amount type inconsistency
Migration 007 creates `total_amount integer` and `commission_amount integer`. Migration 012 attempts to add them as `numeric` with `IF NOT EXISTS`, which silently skips because they already exist. The columns remain as `integer` in the actual database, which is correct for ZAR cent values but inconsistent with the migration intent.

### 5. Duplicate embedding columns
5 tables have their own `embedding vector(1536)` column, but all embeddings are stored in the centralized `content_embeddings` table. The per-table columns are never read or written.

---

## Missing Foreign Keys

| Table | Column | Should Reference | Current State |
|---|---|---|---|
| bookings | client_id | auth.users(id) | Has FK (from migration) |
| rental_reviews | reviewer_id | profiles(id) or auth.users(id) | **NO FK** (just uuid) |
| crew_requests | - | No client user FK | client_email is text only, no user link |

---

## Type Issues

| Table | Column | Current Type | Expected Type | Issue |
|---|---|---|---|---|
| bookings | subtotal, vat, total, etc. | integer | integer | OK for cents, but inconsistent with equipment_bookings which uses numeric |
| equipment_bookings | total_price, deposit_amount | numeric | numeric | Fine |
| crew_requests | total_amount, commission_amount | integer | Should be numeric (migration 012 intended this) | Won't break but inconsistent |
| notifications | type | text with CHECK | text with CHECK | The CHECK only allows gig_* and payment_received types, but code inserts `booking_*` and `service_*` types too — **this will fail** |

### CRITICAL: notifications.type CHECK constraint
Migration 010 defines:
```sql
type text NOT NULL CHECK (type IN ('gig_request', 'gig_confirmed', 'gig_declined',
  'gig_completed', 'gig_cancelled', 'payment_received'))
```

But the codebase inserts these notification types:
- `booking_accepted`, `booking_rejected`, `booking_completed`, `booking_cancelled` (from service-bookings/[id]/status)
- `payout_initiated`, `payout_completed` (from admin/service-bookings/[id]/payout)
- `booking_reassigned`, `booking_admin_cancelled`, `booking_admin_completed` (from admin/service-bookings/[id])

**These inserts will fail** with a CHECK constraint violation unless the constraint was altered outside of migrations. The 0 row count for notifications suggests this may already be broken.

---

## Recommended Changes

### Drop (dead tables/columns)
1. **DROP TABLE** `contact_messages` — never used in code, 0 rows
2. **DROP TABLE** `smart_crews` — superseded by individual profiles, 0 rows
3. **DROP TABLE** `smart_crew_members` — join table for dead smart_crews, 0 rows
4. **DROP COLUMN** `embedding` from profiles, smart_rentals, smart_productions, press, careers — all dead, embeddings use content_embeddings
5. **DROP BUCKET** `bug-screenshots` — not referenced in code, 0 policies

### Add (missing indexes)
```sql
-- High priority (active tables with data)
CREATE INDEX idx_booking_payments_booking ON booking_payments(booking_id);
CREATE INDEX idx_equipment_bookings_user ON equipment_bookings(user_id);
CREATE INDEX idx_equipment_bookings_rental ON equipment_bookings(rental_id);
CREATE INDEX idx_crew_requests_creator ON crew_requests(creator_id);
CREATE INDEX idx_smart_rentals_owner ON smart_rentals(owner_id);
CREATE INDEX idx_listings_user ON listings(user_id);

-- Medium priority (active tables, no data yet)
CREATE INDEX idx_orders_buyer ON orders(buyer_id);
CREATE INDEX idx_orders_seller ON orders(seller_id);
CREATE INDEX idx_orders_listing ON orders(listing_id);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX idx_invoices_booking ON invoices(booking_id);
CREATE INDEX idx_cart_items_rental ON cart_items(rental_id);
```

### Fix (critical issues)
1. **FIX notifications.type CHECK constraint** — either drop the CHECK or expand it to include all types the code inserts:
   ```sql
   ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
   ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
     CHECK (type IN (
       'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed', 'gig_cancelled',
       'payment_received', 'booking_accepted', 'booking_rejected', 'booking_completed',
       'booking_cancelled', 'payout_initiated', 'payout_completed', 'booking_reassigned',
       'booking_admin_cancelled', 'booking_admin_completed'
     ));
   ```

2. **ADD FK** on rental_reviews.reviewer_id → profiles(id)

3. **VERIFY RLS** on all tables marked UNKNOWN — run `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` with a Supabase access token to confirm which tables have RLS enabled. Priority: profiles, equipment_bookings, booking_payments, orders, invoices, subscriptions.

### Consider (non-urgent)
1. **Merge** `reviews`, `crew_reviews`, `rental_reviews` into one polymorphic reviews table — all have 0 rows, now is the time
2. **Evaluate** whether `equipment_bookings` and `bookings` should be merged (both are equipment/service booking systems that evolved separately)
3. **Remove** `bookings.client_rating` and `bookings.client_review` if moving to a proper reviews table, or remove `reviews` table if keeping inline reviews
4. **Add NOT NULL** to commonly required columns: equipment_bookings.status, booking_payments.status, orders.status, etc.

---

## Appendix: Full Table-to-Code Mapping

### Tables with READ operations
| Table | Read by (files) |
|---|---|
| profiles | verifications.ts, profiles.ts, crew.ts, creatorReviews.ts, ranking/calculate.ts, auth/supabase.ts, search/supabase.ts, BookingWidget.tsx, dashboard/page.tsx, dashboard/layout.tsx, dashboard/profile/page.tsx, book/page.tsx, admin/page.tsx, admin/users, admin/verifications, listings route, subscriptions route, payfast/checkout, cart/checkout, auth/callback |
| smart_rentals | smartRentals.ts, search/supabase.ts, ranking/calculate.ts, bookings route, rentals/availability, listings route, cart route, cart/checkout, admin/rentals, admin/rentals/import, smart-production/[slug], admin/page.tsx |
| smart_productions | smartProductions.ts, search/supabase.ts, rag/indexer.ts, admin/productions, admin/page.tsx, smart-creators/[slug] |
| equipment_bookings | bookings.ts, bookings routes, rentals/availability, cart/checkout, webhooks/payfast, webhooks/paystack, dashboard/page.tsx |
| booking_payments | bookings.ts, bookings route, cart/checkout, webhooks/payfast, webhooks/paystack |
| bookings | service-bookings.ts, service-bookings routes, admin/service-bookings routes, webhooks/payfast, dashboard/page.tsx |
| listings | marketplace.ts, smartRentals.ts, search/supabase.ts, smart-creators/[slug], dashboard/page.tsx |
| orders | orders routes, dashboard/page.tsx |
| press | press.ts, search/supabase.ts, admin/press, admin/page.tsx |
| careers | careers.ts, search/supabase.ts, admin/careers, admin/page.tsx |
| crew_requests | crew.ts, creator-requests routes, dashboard/page.tsx, gigs/[id], admin/creator-requests |
| notifications | notifications.ts, notifications routes |
| banking_details | banking.ts, banking route, creator-requests/[id], admin/service-bookings/[id]/payout |
| cart_items | cart.ts |
| reviews | creatorReviews.ts |
| crew_reviews | crew.ts |
| rental_reviews | ranking/calculate.ts |
| subscriptions | subscriptions routes, webhooks/payfast, webhooks/paystack, payfast/checkout |
| subscription_plans | subscriptions/plans, subscriptions route |
| content_embeddings | (via match_content RPC only) |

### Tables with WRITE operations
| Table | Written by (files) |
|---|---|
| profiles | verifications.ts, onboarding route, admin/users/[id]/role, admin/verifications/[id], dashboard/profile/page.tsx |
| smart_rentals | admin/rentals, listings route, ranking/calculate.ts, admin/rentals/import |
| smart_productions | admin/productions |
| equipment_bookings | bookings.ts, bookings route, cart/checkout, webhooks/payfast, webhooks/paystack |
| booking_payments | bookings.ts, bookings route, cart/checkout, webhooks/payfast, webhooks/paystack |
| bookings | service-bookings route, service-bookings/[id]/status, service-bookings/[id]/review, admin/service-bookings/[id], admin/service-bookings/[id]/payout, webhooks/payfast |
| listings | marketplace.ts |
| orders | orders/[id] |
| press | admin/press |
| careers | admin/careers |
| crew_requests | crew.ts, creator-requests/[id], webhooks/payfast |
| notifications | crew.ts, creator-requests/[id], service-bookings/[id]/status, webhooks/payfast, admin/service-bookings/[id], admin/service-bookings/[id]/payout, notifications/[id], notifications/mark-all-read |
| banking_details | banking route |
| cart_items | cart.ts |
| subscriptions | subscriptions route, subscriptions/cancel, payfast/checkout, webhooks/payfast, webhooks/paystack |
| content_embeddings | rag/indexer.ts |
| invoices | bookings.ts |

### Tables NEVER written to
| Table | Reason |
|---|---|
| contact_messages | Dead table |
| smart_crews | Dead table |
| smart_crew_members | Dead table |
| reviews | Read-only (review data lives on bookings.client_rating instead) |
| crew_reviews | Read-only, 0 rows (no write path exists in code) |
| rental_reviews | Read-only, 0 rows (no write path exists in code) |
| subscription_plans | Seed data only — no admin CRUD for plans |
