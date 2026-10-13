# Access control: RLS, policies and grants

Generated on 2026-10-10 from a local database rebuilt from this repo
(`scripts/db/rebuild-local.sh`, base schema + migrations through 077), with
the queries in [README.md](README.md#regenerating-these-documents). It
describes what the **repo** builds. Production may differ where it drifted;
before applying 077 there, take the snapshot in
[README.md](README.md#before-applying-077-to-dev-or-production).

`lib/migrations/rls-coverage.test.sql` turns the rules below into checks
that fail the build of a database: run it after every migration.

## How access works here

- **PostgREST roles.** A request with only the public (anon) key runs as
  `anon`; a signed-in request runs as `authenticated` with the user's JWT in
  `request.jwt.claims` (`auth.uid()`, `auth.jwt()`). The server's
  `createAdminClient()` runs as `service_role`, which has `BYPASSRLS`: RLS
  never limits it, so every service-role path must check the user itself.
- **Two gates.** A client needs a table/column **grant** for the command,
  and then a **policy** that lets the row through. Supabase grants ALL on new
  tables to `anon` and `authenticated` by default, so before 077 RLS was the
  only gate on most tables. Since 077 `anon` holds no write grant on any
  table, and `authenticated` holds a write grant only where a policy uses it.
- **Policies are permissive** (OR-ed). An UPDATE policy without `WITH CHECK`
  reuses its `USING` for the new row, so "own row" policies cannot reassign
  ownership; what they do not limit is the other columns, which is what
  067's column grants and guard triggers are for (`profiles`,
  `banking_details`, `reviews`).
- **`is_admin()`** is SECURITY DEFINER and executable by everyone, because
  policies granted to `public` call it as the querying role (043). It is true
  for JWT `app_metadata.role = 'admin'` or `profiles.role = 'admin'`. The
  third admin path, the `ADMIN_EMAILS` break-glass in `lib/auth/supabase.ts`,
  exists only in API routes; RLS does not know about it.

## Migration 080 (Phase 8, owner pickup)

No new table, policy or function signature. What changes for access:

- `delivery_addresses` gains `purpose = 'owner_pickup'` rows. The existing
  policy ("Own delivery addresses": `user_id = auth.uid()`) is exactly the
  rule wanted: the owner reads their own pickup address; the renter of an
  order collected from it, other owners, strangers and **admins through the
  API** read nothing of it (staff see it only through the audited, strictly
  rate-limited `reveal_address` action, which runs as the server and is
  logged, D21/D-88). Clients have no write grant: an owner changes their
  address only through `PUT /api/delivery/owner-pickup`, which verifies it
  on the server first.
- `delivery_shipments.origin_owner_id` is **not** in the column grant to
  `authenticated` (076's 15 columns are unchanged). `delivery_quotes` (076:
  granted table-wide) is a column grant since 080's review fixes: the renter
  reads their own quotes' fee, status, window and lines, never
  `quote_amount_cents`, `provider_cost_cents`, `platform_fee_cents`,
  `provider_quote_ref`, `origin_owner_id`, `origin_address_id` or
  `destination_address_id`. No client reads `delivery_quotes` directly today
  (every read is the server's, service role), so nothing depends on the
  columns taken away. The fee itself is priced from a ~2 km grid cell for an
  owner trip (D-93), so it cannot place the owner's house.
- `delivery_save_owner_pickup` and `delivery_remove_owner_pickup` (080):
  replace (retire + store, one transaction) or retire the owner's active
  pickup address, refused while a leg from or back to it is under way,
  checked under a per-owner advisory lock that `delivery_create_shipment`
  also takes for an owner leg (which in turn refuses a leg whose quoted
  owner address was retired: R-91). SECURITY DEFINER,
  `search_path = public, pg_temp`, execute for `service_role` only.
- `delivery_cancelled_orders_to_settle` is replaced in 080 (per-origin
  "gear may be with the renter" rule), same settings and grant as 076.
- `listing_private.owner_pickup`: the owner (and admins) read it under the
  072 policies; nobody but the server writes `listing_private`.
- `delivery_create_shipment` and `delivery_redact_address` are replaced in
  place: SECURITY DEFINER, `search_path = public, pg_temp`, execute for
  `service_role` only (restated in 080).

Proved by `lib/migrations/080-owner-pickup.test.sql` (3a–3f, 4, 6, 8, 9, 10, 11) and
`rls-coverage.test.sql` (unchanged allow-lists).

## Summary (after 077)

| Item | Count |
|---|---|
| Tables in `public` | 71 |
| With RLS on | 71 (all) |
| Policies | 92 |
| Tables with RLS on and no policy (clients denied; server only) | 17: `delivery_cancelled_order_notes`, `delivery_dispatch_intents`, `delivery_manual_tasks`, `delivery_proofs`, `delivery_provider_events`, `delivery_reconciliation`, `dispute_comments`, `disputes`, `ledger_journals`, `ledger_lines`, `moderation_log`, `notification_outbox`, `payment_confirmations`, `payment_events`, `phone_codes`, `rental_escalations`, `security_audit_log` |
| Tables anon can SELECT (grant; rows still filtered by RLS) | 43 |
| Tables anon can write | 0 |
| Tables authenticated holds a write grant on (each has a policy for that command; most are admin-only `is_admin()` policies) | 22: `booking_payments`, `bug_reports`, `careers`, `cart_items`, `consent_records`, `crew_requests`, `equipment_bookings`, `feature_flags`, `invoices`, `listings`, `notifications`, `onboarding_progress`, `orders`, `portfolio_analysis`, `portfolio_tag_corrections`, `press`, `profiles`, `reviews`, `smart_productions`, `smart_rentals`, `subscription_plans`, `subscriptions` |
| SECURITY DEFINER functions | 52, all with a pinned `search_path` ending in `pg_temp` |
| SECURITY DEFINER functions anon can execute | 3, all allow-listed: `is_admin()` (see above), `busy_creator_ids(uuid[])` (Ubunye's creator search as the visitor; returns creator ids with an active gig, nothing else) and `profile_is_creator(profiles)` (called by `public_profiles` as the reader; definer so the answer does not depend on who reads) |
| Client-readable views that bypass RLS | 1: `public_profiles` (the column filter over `profiles`, by design) |

## Flagged items

### Fixed by 077 (they existed in a database rebuilt from the repo at 076)

| Flag | Where | What it allowed | 077 |
|---|---|---|---|
| Read policy `true` on personal data | `profiles` "Public can view profiles" (base schema; 036 dropped production's *name* for it, not this one) | anyone with the public key read every profile in full: phone, address, ID document hash, verification paths, fraud flags | E1: dropped (with the base schema's "Users can update/insert own profile") |
| Write policy `true` | `crew_requests` "Admins can manage crew requests" (`USING (true)`, all roles) and "Anyone can submit crew request" (`WITH CHECK (true)`) | anyone read, changed or deleted every crew request (client names, e-mails, phones) and created new ones | E2: admin policy checks `is_admin()`; the open insert is dropped; clients read their own by e-mail. E11: `busy_creator_ids()` keeps Ubunye's "busy" flag working without reading requests |
| RLS disabled | `content_embeddings` | anyone wrote or deleted the text RAG answers from | E3: RLS on, read kept, writes server only |
| Client could invent money rows | `orders` "Buyers can create orders" | a buyer created an order naming any seller, any total and status | E4: dropped |
| Client could self-publish | `listings` "Users can create own listings" / "update own listings" with a table-wide grant | publish an unreviewed listing into the sitemap, search and Ubunye's system prompt | E10: dropped (no app code writes listings as the user) |
| Personal column readable by anon | `reviews.reviewer_email` | e-mail of every published review's author | E9: column excluded from the client SELECT grant |
| anon write grants | 42 tables (INSERT/UPDATE), 45 (DELETE, TRUNCATE, REFERENCES, TRIGGER) | nothing while RLS held; one bad policy away from writes (as `crew_requests` showed). TRUNCATE ignores RLS (PostgREST cannot issue it) | E5: all revoked on ThabangVision's tables (explicit list; other apps' tables are reported and left alone) |
| authenticated write grants no policy used | 73 grants on 27 tables, e.g. `bookings`, `platform_events`, `notifications` INSERT, `disputes` | nothing while RLS held | E5: revoked (the apply prints the list) |
| SECURITY DEFINER without `pg_temp` last | `is_admin`, `submit_verification_request`, `admin_list/get/approve/reject_verification`, `caller_owns_rental`, `notify_signup`, `set_signup_webhook` | a temporary object could shadow an unqualified name | E6: `pg_temp` appended (ThabangVision's own functions only, owned by the applying role; an empty path becomes `pg_catalog, pg_temp`) |
| SECURITY DEFINER executable by anon | `caller_owns_rental`, `refund_obligations_cap` (trigger), `agent_actions_supersede` (trigger) | harmless today (`auth.uid()` is null for anon; trigger functions cannot be called directly) | E6: revoked; `is_admin()` remains, allow-listed |
| Invoker functions with no `search_path` | `guard_phone_verified`, `ledger_refuse_change`, `service_booking_events_append_only` | audit D5 | E6: pinned |
| RLS on, no policy, but the app writes as the user | `onboarding_progress` (browser upsert), `portfolio_analysis` (portfolio agent insert) | the writes were silently refused: onboarding could not resume, analyses were lost | E7: own-row policies |
| View readable by clients | `unmet_demand_summary` (anon SELECT and INSERT grants) | nothing (security_invoker, base table service only) | E8: grants removed |

### Still flagged after 077 (generated)

- `bug_reports`: authenticated has table-wide INSERT and a non-admin policy, so a user may set `status` on rows the policy allows
- `content_embeddings`: read policy "Anyone reads content embeddings" is `true` (allow-listed: yes)
- `feature_flags`: read policy "anyone_reads_flags" is `true` (allow-listed: yes)

What they mean:

- `feature_flags` and `content_embeddings` read policies are `true` on
  purpose and allow-listed in `rls-coverage.test.sql`: flags are public
  configuration, embeddings are derived from published catalogue text.
- `bug_reports`: a user can file a report with any `status`. Harmless;
  recommendation only.
- `listings` is no longer flagged: after 077 owners may only delete their
  own rows and admins do the rest. If the marketplace gets an owner editor,
  give it a review gate like `smart_rentals` (072) first (risk R-65).
- Column-level grants: `authenticated` may UPDATE its own `profiles` row on
  067's allow-list. That list includes `specializations`, `crew_bio` and
  `portfolio_projects` (via `/api/portfolio`), i.e. a person can declare
  themselves a creator, which since 077 puts them in `public_profiles`
  (display fields only; portfolio masked until verified). Being a creator is
  self-declared by design (decision D-61). `onboarding_completed_at` is on
  the list too but is NOT a creator signal: generic onboarding sets it for
  any account.

## Views

| View | Mode | anon | authenticated |
|---|---|---|---|
| `payment_reference_mismatches` | **runs as owner** (bypasses RLS) | — | — |
| `public_profiles` | **runs as owner** (bypasses RLS) | S | S |
| `unmet_demand_summary` | security_invoker (RLS of the base tables applies) | — | — |

## SECURITY DEFINER functions

See [auth-and-roles.md](auth-and-roles.md#security-definer-functions) for the
list with who may execute each.

## Storage

| Bucket | Public | Policies (storage.objects) |
|---|---|---|
| `verifications` | no | authenticated INSERT and SELECT in their own folder (`<user id>/…`) only; no UPDATE (067 dropped it) or DELETE. The upload route writes with the service role (`submit_verification_for_user`). |

## Matrix: every public table

Legend: policies are `role: condition` per command (`all` = every role,
including anon; `own (col)` = `auth.uid() = col`; `admin` = `is_admin()`;
an `ALL` policy appears under each command). Grants: S select, I insert,
U update, D delete, T truncate, R references, Tg trigger; `U(30 cols)` =
column-level grant on that many columns. `service_role` holds everything and
bypasses RLS, so it is not shown.

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | anon grants | authenticated grants |
|---|---|---|---|---|---|---|---|
| `agent_actions` | on | authenticated: own (user_id) | — | — | — | — | S |
| `ai_budget_alerts` | on | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | S | S |
| `ai_token_usage` | on | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | S | S |
| `banking_details` | on | all: own (user_id) | all: own (user_id) | authenticated: own (user_id) | — | S | S |
| `booking_payments` | on | all: `(EXISTS ( SELECT 1 FROM equipment_bookings eb WHERE ((eb.id = booking_payments.booking_…`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `booking_status_history` | on | authenticated: `(admin OR (EXISTS ( SELECT 1 FROM equipment_bookings b WHERE ((b.id = booking_status_hi…` | — | — | — | — | S |
| `bookings` | on | all: own (client_id)<br>all: own (creator_id) | — | — | — | S | S |
| `bug_reports` | on | authenticated: own (user_id) | authenticated: own (user_id) | — | — | S | SI |
| `careers` | on | all: `((is_published = true) AND (deleted_at IS NULL))`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `cart_items` | on | all: own (user_id) | all: own (user_id) | all: own (user_id) | all: own (user_id) | S | SIUD |
| `chat_conversations` | on | all: own (user_id)<br>all: `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role =…` | — | — | — | S | S |
| `chat_faqs` | on | all: `(is_published = true)`<br>all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | S | S |
| `chat_messages` | on | all: `(conversation_id IN ( SELECT chat_conversations.id FROM chat_conversations WHERE (chat_…`<br>all: `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role =…` | — | — | — | S | S |
| `consent_records` | on | authenticated: own (user_id) | authenticated: own (user_id) | — | — | — | SI |
| `content_embeddings` | on | all: **true** | — | — | — | S | S |
| `crew_requests` | on | all: own (creator_id)<br>all: admin<br>authenticated: `((client_email IS NOT NULL) AND (lower(client_email) = lower((auth.jwt() ->> 'email'::t…` | all: admin | all: admin | all: admin | S | SIUD |
| `delivery_addresses` | on | authenticated: own (user_id) | — | — | — | — | S |
| `delivery_cancelled_order_notes` | on | — | — | — | — | — | — |
| `delivery_custody_events` | on | authenticated: `(admin OR delivery_is_renter(shipment_id) OR delivery_owns_any(shipment_id, ARRAY[booki…` | — | — | — | — | S(15 cols) |
| `delivery_dispatch_intents` | on | — | — | — | — | — | — |
| `delivery_events` | on | authenticated: `(admin OR delivery_is_renter(shipment_id))` | — | — | — | — | S(8 cols) |
| `delivery_incidents` | on | authenticated: `(admin OR delivery_is_renter(shipment_id) OR delivery_owns_all(shipment_id, booking_ids))` | — | — | — | — | S(14 cols) |
| `delivery_manual_tasks` | on | — | — | — | — | — | — |
| `delivery_proofs` | on | — | — | — | — | — | — |
| `delivery_provider_events` | on | — | — | — | — | — | — |
| `delivery_quotes` | on | authenticated: `((renter_id = auth.uid()) OR admin)` | — | — | — | — | S(20 cols) |
| `delivery_reconciliation` | on | — | — | — | — | — | — |
| `delivery_shipments` | on | authenticated: `((renter_id = auth.uid()) OR (auth.uid() = ANY (owner_ids)) OR admin)` | — | — | — | — | S(15 cols) |
| `dispute_comments` | on | — | — | — | — | S | S |
| `disputes` | on | — | — | — | — | S | S |
| `equipment_bookings` | on | all: own (user_id)<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `feature_flag_events` | on | all: admin | — | — | — | S | S |
| `feature_flags` | on | all: **true**<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `invoices` | on | all: `(EXISTS ( SELECT 1 FROM equipment_bookings eb WHERE ((eb.id = invoices.booking_id) AND …`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `ledger_journals` | on | — | — | — | — | — | — |
| `ledger_lines` | on | — | — | — | — | — | — |
| `listing_private` | on | authenticated: `caller_owns_rental(rental_id)`<br>authenticated: admin | — | — | — | — | S |
| `listings` | on | all: `((is_published = true) AND (deleted_at IS NULL))`<br>all: admin | all: admin | all: admin | all: own (user_id)<br>all: admin | S | SIUD |
| `moderation_log` | on | — | — | — | — | S | S |
| `newsletter_subscribers` | on | all: nobody | all: nobody | all: nobody | all: nobody | S | S |
| `notification_outbox` | on | — | — | — | — | — | — |
| `notifications` | on | all: own (user_id) | — | all: own (user_id) | — | S | SU |
| `onboarding_progress` | on | authenticated: own (creator_id) | authenticated: own (creator_id) | authenticated: own (creator_id) | authenticated: own (creator_id) | S | SIUD |
| `ops_check_runs` | on | all: nobody | all: nobody | all: nobody | all: nobody | S | S |
| `ops_findings` | on | all: nobody | all: nobody | all: nobody | all: nobody | S | S |
| `orders` | on | all: own (buyer_id)<br>all: own (seller_id)<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `owner_payouts` | on | authenticated: `((owner_id = auth.uid()) OR admin)` | — | — | — | — | S |
| `payment_confirmations` | on | — | — | — | — | S | S |
| `payment_events` | on | — | — | — | — | — | — |
| `phone_codes` | on | — | — | — | — | S | S |
| `platform_events` | on | authenticated: admin | — | — | — | S | S |
| `portfolio_analysis` | on | authenticated: own (creator_id) | authenticated: own (creator_id) | — | — | S | SI |
| `portfolio_tag_corrections` | on | all: own (creator_id) | all: own (creator_id) | — | — | S | SI |
| `press` | on | all: `((is_published = true) AND (deleted_at IS NULL))`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `production_categories` | on | all: `(is_published = true)` | — | — | — | S | S |
| `profiles` | on | authenticated: own (id)<br>authenticated: admin<br>all: admin | authenticated: own (id)<br>all: admin | authenticated: own (id); check `((id = auth.uid()) AND (role = ( SELECT p.role FROM profiles p WHERE (p.id = auth.uid()…`<br>all: admin | all: admin | S | SD I(30 cols) U(29 cols) |
| `rate_limits` | on | all: nobody | all: nobody | all: nobody | all: nobody | S | S |
| `refund_obligations` | on | authenticated: `((user_id = auth.uid()) OR admin)` | — | — | — | — | S |
| `rental_blocks` | on | authenticated: admin | — | — | — | — | S |
| `rental_escalations` | on | — | — | — | — | — | — |
| `rental_payment_intents` | on | authenticated: `((user_id = auth.uid()) OR admin)` | — | — | — | — | S |
| `reviews` | on | all: `(is_published = true)` | all: own (reviewer_id) | authenticated: own (reviewer_id) | — | S(13 cols) | S(13 cols) U(2 cols) |
| `security_audit_log` | on | — | — | — | — | — | — |
| `service_booking_events` | on | authenticated: `(EXISTS ( SELECT 1 FROM bookings b WHERE ((b.id = service_booking_events.booking_id) AN…` | — | — | — | — | S |
| `smart_productions` | on | all: `((is_published = true) AND (deleted_at IS NULL))`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `smart_rentals` | on | all: `((is_published = true) AND (deleted_at IS NULL))`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `subscription_plans` | on | all: `(is_active = true)`<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `subscriptions` | on | all: own (user_id)<br>all: admin | all: admin | all: admin | all: admin | S | SIUD |
| `ubunye_usage` | on | all: own (user_id)<br>all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | all: service_role (no effect: it bypasses RLS) | S | S |
| `unmet_demand` | on | all: nobody | all: nobody | all: nobody | all: nobody | S | S |
| `welcome_messages` | on | all: `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::te…` | — | — | — | S | S |
