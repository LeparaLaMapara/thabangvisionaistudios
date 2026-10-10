# Database schema

Generated on 2026-10-10 from a local database rebuilt from this repo with `scripts/db/rebuild-local.sh` (base schema + migrations through 077). Columns, keys, constraints, RLS state and "created by" come from `pg_catalog` / `information_schema` (queries in [README.md](README.md#regenerating-these-documents)); the purpose and domain lines were written by reading the code that uses each table. Production may differ where it drifted (see the audit's D4); it also holds other apps' tables in `public` (`apps`, `kb_*`, `blog_*`), which are not ThabangVision's and are not listed here.

71 tables and 3 views in `public`.

## Money: cents or rands

The newer pipeline (070–076) stores integer **cents** in columns named `*_cents`. Everything older stores **rands**, as `numeric` (may hold cents after the point) or as `integer` (whole rands). `CLAUDE.md` says booking amounts in `bookings` and `booking_payments` are cents: **they are not**. `bookings.subtotal/vat/total/creator_amount/platform_amount` are whole rands (`lib/bookings/pricing.ts` rounds to the rand), and `booking_payments.amount` is rands (`/api/cart/checkout` writes the rand amount due; `fulfil.ts` compares it with the gateway's rand amount).

| Table | Cents columns | Rand columns |
|---|---|---|
| `agent_actions` | `amount_cents` | — |
| `ai_budget_alerts` | — | `spend`, `budget` |
| `ai_token_usage` | — | `estimated_cost` |
| `booking_payments` | — | `amount` |
| `bookings` | — | `subtotal` (whole), `vat` (whole), `total` (whole), `platform_commission` (whole), `platform_amount` (whole), `creator_amount` (whole), `paystack_fee_estimate` (whole), `cancellation_refund_amount` |
| `crew_requests` | — | `total_amount` (whole), `commission_amount` (whole), `quoted_rate`, `deposit_amount` |
| `delivery_quotes` | `quote_amount_cents`, `provider_cost_cents`, `platform_fee_cents`, `customer_fee_cents`, `replacement_value_cents` | — |
| `delivery_reconciliation` | `quoted_cents`, `accrued_cents`, `invoiced_cents`, `difference_cents` | — |
| `delivery_shipments` | `quote_amount_cents`, `customer_fee_cents`, `platform_fee_cents`, `accrued_cost_cents`, `provider_cost_cents`, `replacement_value_cents` | — |
| `disputes` | — | `resolution_amount` |
| `equipment_bookings` | `hire_cents`, `deposit_cents`, `owner_share_cents`, `platform_share_cents`, `unit_replacement_value_cents` | `total_price`, `deposit_amount`, `deposit_released`, `late_fee`, `delivery_fee`, `cancellation_refund_amount`, `cancellation_fee`, `damage_fee`, `amount_due` |
| `invoices` | — | `amount` |
| `ledger_lines` | `debit_cents`, `credit_cents` | — |
| `listings` | — | `price` |
| `orders` | — | `total`, `platform_fee`, `seller_payout` |
| `owner_payouts` | `gross_rental_amount_cents`, `platform_commission_cents`, `owner_amount_cents`, `provider_fee_cents` | — |
| `payment_confirmations` | — | `amount` |
| `production_categories` | — | `starting_rate` (whole) |
| `profiles` | — | `hourly_rate` (whole) |
| `public_profiles` | — | `hourly_rate` (whole) |
| `refund_obligations` | `amount_cents`, `charged_cents` | — |
| `rental_payment_intents` | `expected_amount_cents`, `hire_cents`, `deposit_cents`, `delivery_cents` | — |
| `smart_productions` | — | `price` (whole) |
| `smart_rentals` | — | `price_per_day`, `price_per_week`, `deposit_amount`, `replacement_value` |
| `subscription_plans` | — | `price` |
| `subscriptions` | `expected_amount_cents` | — |

Rands still in use (flagged): every column in the right-hand column above. Two tables carry both: `equipment_bookings` (070 added `hire_cents`, `deposit_cents`, `owner_share_cents`, `platform_share_cents` beside the older rand columns) and `bookings` (whole rands throughout). Converting them is a recommendation, not done here (R-66).

## Tables by domain

- **accounts**: [`consent_records`](#consent_records), [`phone_codes`](#phone_codes), [`profiles`](#profiles), [`public_profiles`](#public_profiles), [`welcome_messages`](#welcome_messages)
- **admin**: [`feature_flag_events`](#feature_flag_events), [`feature_flags`](#feature_flags), [`moderation_log`](#moderation_log), [`security_audit_log`](#security_audit_log)
- **agent**: [`agent_actions`](#agent_actions), [`ai_budget_alerts`](#ai_budget_alerts), [`ai_token_usage`](#ai_token_usage), [`chat_conversations`](#chat_conversations), [`chat_faqs`](#chat_faqs), [`chat_messages`](#chat_messages), [`content_embeddings`](#content_embeddings), [`ubunye_usage`](#ubunye_usage)
- **content**: [`careers`](#careers), [`newsletter_subscribers`](#newsletter_subscribers), [`press`](#press)
- **delivery**: [`delivery_addresses`](#delivery_addresses), [`delivery_cancelled_order_notes`](#delivery_cancelled_order_notes), [`delivery_custody_events`](#delivery_custody_events), [`delivery_dispatch_intents`](#delivery_dispatch_intents), [`delivery_events`](#delivery_events), [`delivery_incidents`](#delivery_incidents), [`delivery_manual_tasks`](#delivery_manual_tasks), [`delivery_proofs`](#delivery_proofs), [`delivery_provider_events`](#delivery_provider_events), [`delivery_quotes`](#delivery_quotes), [`delivery_reconciliation`](#delivery_reconciliation), [`delivery_shipments`](#delivery_shipments)
- **marketplace**: [`listings`](#listings), [`orders`](#orders), [`reviews`](#reviews)
- **payments**: [`banking_details`](#banking_details), [`booking_payments`](#booking_payments), [`invoices`](#invoices), [`ledger_journals`](#ledger_journals), [`ledger_lines`](#ledger_lines), [`owner_payouts`](#owner_payouts), [`payment_confirmations`](#payment_confirmations), [`payment_events`](#payment_events), [`payment_reference_mismatches`](#payment_reference_mismatches), [`refund_obligations`](#refund_obligations), [`rental_payment_intents`](#rental_payment_intents), [`subscription_plans`](#subscription_plans), [`subscriptions`](#subscriptions)
- **platform**: [`bug_reports`](#bug_reports), [`notification_outbox`](#notification_outbox), [`notifications`](#notifications), [`ops_check_runs`](#ops_check_runs), [`ops_findings`](#ops_findings), [`platform_events`](#platform_events), [`rate_limits`](#rate_limits), [`unmet_demand`](#unmet_demand), [`unmet_demand_summary`](#unmet_demand_summary)
- **rentals**: [`booking_status_history`](#booking_status_history), [`cart_items`](#cart_items), [`dispute_comments`](#dispute_comments), [`disputes`](#disputes), [`equipment_bookings`](#equipment_bookings), [`listing_private`](#listing_private), [`rental_blocks`](#rental_blocks), [`rental_escalations`](#rental_escalations), [`smart_rentals`](#smart_rentals)
- **services**: [`bookings`](#bookings), [`crew_requests`](#crew_requests), [`onboarding_progress`](#onboarding_progress), [`portfolio_analysis`](#portfolio_analysis), [`portfolio_tag_corrections`](#portfolio_tag_corrections), [`production_categories`](#production_categories), [`service_booking_events`](#service_booking_events), [`smart_productions`](#smart_productions)

## Tables and views

### agent_actions

*table · domain: agent · created by `074-agent-actions` · RLS **on***

Bookings an agent prepared and the user must confirm; one live action per kind (074).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Checks: `agent_actions_amount_cents_check`: `CHECK ((amount_cents >= 0))`; `agent_actions_kind_check`: `CHECK ((kind = ANY (ARRAY['gear_booking', 'service_booking'])))`; `agent_actions_state_check`: `CHECK ((state = ANY (ARRAY['prepared', 'committing', 'committed', 'failed', 'cancelled', 'superseded'])))`

<details><summary>Columns (15)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no |  |  |
| `user_id` | uuid | no |  |  |
| `conversation_id` | uuid | yes |  |  |
| `kind` | text | no |  |  |
| `state` | text | no | `'prepared'::text` |  |
| `amount_cents` | integer | no |  | cents |
| `quote_version` | integer | no | `1` |  |
| `payload` | jsonb | no |  |  |
| `summary` | jsonb | no |  |  |
| `nonce_hash` | text | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `result` | jsonb | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `committed_at` | timestamp with time zone | yes |  |  |

</details>

### ai_budget_alerts

*table · domain: agent · created by `024-ai-token-usage` · RLS **on***

Monthly AI budget alerts already sent (024).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (period, threshold)`

<details><summary>Columns (6)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `period` | text | no |  |  |
| `threshold` | integer | no |  |  |
| `spend` | numeric | no |  | rands |
| `budget` | numeric | no |  | rands |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### ai_token_usage

*table · domain: agent · created by `024-ai-token-usage` · RLS **on***

One row per AI call: model, tokens, estimated cost in rands (024, `trackedCompletion`).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE SET NULL`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | yes |  |  |
| `model` | text | no |  |  |
| `input_tokens` | integer | no | `0` |  |
| `output_tokens` | integer | no | `0` |  |
| `total_tokens` | integer | no | `0` |  |
| `estimated_cost` | numeric | no | `0` | rands |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### banking_details

*table · domain: payments · created by `012-banking-details` · RLS **on***

A creator's / owner's payout account (tokenised, 046). Written only by `/api/banking` with the service role (067); the owner may read their row.

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- Unique: `UNIQUE (user_id)`
- Checks: `banking_details_account_type_check`: `CHECK ((account_type = ANY (ARRAY['cheque', 'savings'])))`

<details><summary>Columns (12)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `bank_name` | text | no |  |  |
| `bank_code` | text | no |  |  |
| `account_number` | text | yes |  |  |
| `account_type` | text | no |  |  |
| `account_holder` | text | no |  |  |
| `paystack_recipient_code` | text | yes |  |  |
| `is_verified` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `account_last4` | text | yes |  |  |

</details>

### booking_payments

*table · domain: payments · created by `20260311000000_base_schema` · RLS **on***

What the gateway was asked to charge for each gear line at checkout, and whether it was captured (`status`, 077: pending | succeeded | failed | refunded).

- Key: `PRIMARY KEY (id)`
- References: `(booking_id) REFERENCES equipment_bookings(id) ON DELETE CASCADE`
- Checks: `booking_payments_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'succeeded', 'failed', 'refunded'])))`

<details><summary>Columns (9)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `booking_id` | uuid | no |  |  |
| `payfast_payment_id` | text | yes |  |  |
| `amount` | numeric | no |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `status` | text | yes | `'pending'::text` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `payment_provider` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |

</details>

### booking_status_history

*table · domain: rentals · created by `070-gear-pipeline` · RLS **on***

Append-only state changes of gear bookings (070).

- Key: `PRIMARY KEY (id)`
- Checks: `booking_status_history_actor_check`: `CHECK ((actor = ANY (ARRAY['system', 'customer', 'staff', 'owner'])))`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no | `nextval('booking_status_history_id_se...` |  |
| `booking_id` | uuid | no |  |  |
| `from_status` | text | yes |  |  |
| `to_status` | text | no |  |  |
| `actor` | text | no |  |  |
| `actor_id` | uuid | yes |  |  |
| `reason` | text | yes |  |  |
| `at` | timestamp with time zone | no | `now()` |  |

</details>

### bookings

*table · domain: services · created by `014-booking-system` · RLS **on***

Service bookings: a client books a creator for time. Whole-rand amounts, Paystack payment, creator payout state (014, 022, 038, 041, 045, 047, 063, 073).

- Key: `PRIMARY KEY (id)`
- References: `(client_id) REFERENCES auth.users(id)`; `(creator_id) REFERENCES profiles(id)`
- Referenced by: `service_booking_events`
- Unique: `UNIQUE (reference)`
- Checks: `bookings_booking_type_check`: `CHECK ((booking_type = ANY (ARRAY['production', 'rental', 'crew'])))`; `bookings_cancellation_refund_status_check`: `CHECK (((cancellation_refund_status IS NULL) OR (cancellation_refund_status = ANY (ARRAY['pending', 'refunded', 'failed', 'manual_review', 'not_required', 'unknown']))))`; `bookings_client_rating_check`: `CHECK (((client_rating >= 1) AND (client_rating <= 5)))`; `bookings_payment_status_check`: `CHECK ((payment_status = ANY (ARRAY['unpaid', 'paid', 'refunded'])))`; `bookings_payout_status_check`: `CHECK ((payout_status = ANY (ARRAY['pending', 'processing', 'paid', 'failed'])))`; `bookings_revisions_check`: `CHECK (((revisions_used >= 0) AND ((revisions_included IS NULL) OR (revisions_included >= 0))))`; `bookings_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'paid', 'accepted', 'delivered', 'completed', 'paid_out', 'cancelled', 'disputed', 'pending_reassignment', 'declined'])))`

<details><summary>Columns (61)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `reference` | text | no |  |  |
| `client_id` | uuid | no |  |  |
| `client_email` | text | no |  |  |
| `creator_id` | uuid | yes |  |  |
| `booking_type` | text | no |  |  |
| `project_category` | text | no |  |  |
| `project_description` | text | no |  |  |
| `deliverables` | text | no |  |  |
| `duration_hours` | integer | no |  |  |
| `location` | text | yes |  |  |
| `preferred_dates` | text | yes |  |  |
| `subtotal` | integer | no |  | rands (whole) |
| `vat` | integer | no |  | rands (whole) |
| `total` | integer | no |  | rands (whole) |
| `platform_commission` | integer | no | `15` | rands (whole) |
| `platform_amount` | integer | no |  | rands (whole) |
| `creator_amount` | integer | no |  | rands (whole) |
| `paystack_fee_estimate` | integer | yes |  | rands (whole) |
| `payment_status` | text | no | `'unpaid'::text` |  |
| `paystack_reference` | text | yes |  |  |
| `paystack_access_code` | text | yes |  |  |
| `paid_at` | timestamp with time zone | yes |  |  |
| `payout_status` | text | no | `'pending'::text` |  |
| `payout_reference` | text | yes |  |  |
| `paid_out_at` | timestamp with time zone | yes |  |  |
| `status` | text | no | `'pending'::text` |  |
| `client_rating` | integer | yes |  |  |
| `client_review` | text | yes |  |  |
| `admin_notes` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `accepted_at` | timestamp with time zone | yes |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |
| `cancelled_at` | timestamp with time zone | yes |  |  |
| `cancellation_reason` | text | yes |  |  |
| `delivery_url` | text | yes |  |  |
| `delivery_message` | text | yes |  |  |
| `delivered_at` | timestamp with time zone | yes |  |  |
| `payout_retry_count` | integer | yes | `0` |  |
| `shoot_date` | date | yes |  |  |
| `cancellation_refund_amount` | numeric | yes |  | rands |
| `cancellation_refund_percent` | integer | yes |  |  |
| `cancellation_refund_status` | text | yes |  |  |
| `cancellation_refund_error` | text | yes |  |  |
| `cancellation_refunded_at` | timestamp with time zone | yes |  |  |
| `arrived_at` | timestamp with time zone | yes |  |  |
| `payment_provider` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |
| `payout_provider` | text | yes |  |  |
| `declined_at` | timestamp with time zone | yes |  |  |
| `decline_reason` | text | yes |  |  |
| `revisions_included` | integer | yes |  |  |
| `revisions_used` | integer | no | `0` |  |
| `revision_policy` | text | yes |  |  |
| `cancellation_policy` | text | yes |  |  |
| `accepted_by_client_at` | timestamp with time zone | yes |  |  |
| `payout_due_at` | timestamp with time zone | yes |  |  |
| `dispute_window_ends_at` | timestamp with time zone | yes |  |  |
| `payout_claimed_at` | timestamp with time zone | yes |  |  |
| `payout_last_error` | text | yes |  |  |

</details>

### bug_reports

*table · domain: platform · created by `022-bug-reports` · RLS **on***

Bug reports from signed-in users (022).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id)`
- Checks: `bug_reports_severity_check`: `CHECK ((severity = ANY (ARRAY['low', 'medium', 'high', 'critical'])))`; `bug_reports_status_check`: `CHECK ((status = ANY (ARRAY['open', 'in_progress', 'resolved', 'wont_fix', 'duplicate'])))`

<details><summary>Columns (16)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | yes |  |  |
| `user_email` | text | yes |  |  |
| `title` | text | no |  |  |
| `description` | text | no |  |  |
| `steps_to_reproduce` | text | yes |  |  |
| `expected_behaviour` | text | yes |  |  |
| `actual_behaviour` | text | yes |  |  |
| `page_url` | text | yes |  |  |
| `device_info` | text | yes |  |  |
| `browser_info` | text | yes |  |  |
| `severity` | text | yes | `'medium'::text` |  |
| `status` | text | yes | `'open'::text` |  |
| `admin_notes` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |

</details>

### careers

*table · domain: content · created by `20260311000000_base_schema` · RLS **on***

Job posts (base schema).

- Key: `PRIMARY KEY (id)`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `title` | text | no |  |  |
| `department` | text | yes |  |  |
| `location` | text | yes |  |  |
| `description` | text | yes |  |  |
| `employment_type` | text | yes |  |  |
| `requirements` | text[] | yes | `'{}'::text[]` |  |
| `is_published` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | yes |  |  |

</details>

### cart_items

*table · domain: rentals · created by `015-cart-system` · RLS **on***

A signed-in user's cart lines with dates (015, 032).

- Key: `PRIMARY KEY (id)`
- References: `(rental_id) REFERENCES smart_rentals(id) ON DELETE CASCADE`; `(user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- Unique: `UNIQUE (user_id, rental_id)`
- Checks: `cart_items_dates_both_or_neither`: `CHECK ((((start_date IS NULL) AND (end_date IS NULL)) OR ((start_date IS NOT NULL) AND (end_date IS NOT NULL) AND (end_date > start_date))))`; `cart_items_quantity_check`: `CHECK (((quantity >= 1) AND (quantity <= 5)))`

<details><summary>Columns (7)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `rental_id` | uuid | no |  |  |
| `quantity` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `start_date` | date | yes |  |  |
| `end_date` | date | yes |  |  |

</details>

### chat_conversations

*table · domain: agent · created by `037-chat-history` · RLS **on***

Ubunye chat conversations per user (037).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- Referenced by: `chat_faqs`, `chat_messages`
- Checks: `chat_conversations_converted_to_check`: `CHECK ((converted_to = ANY (ARRAY['booking', 'rental_inquiry', 'creator_view', 'quote_request', NULL])))`; `chat_conversations_status_check`: `CHECK ((status = ANY (ARRAY['active', 'ended', 'converted'])))`

<details><summary>Columns (12)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | yes |  |  |
| `agent_id` | text | no | `'assistant'::text` |  |
| `status` | text | no | `'active'::text` |  |
| `message_count` | integer | no | `0` |  |
| `converted_to` | text | yes |  |  |
| `converted_ref` | text | yes |  |  |
| `guest_ip_hash` | text | yes |  |  |
| `metadata` | jsonb | no | `'{}'::jsonb` |  |
| `started_at` | timestamp with time zone | no | `now()` |  |
| `ended_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### chat_faqs

*table · domain: agent · created by `038-chat-faqs` · RLS **on***

Published FAQ answers Ubunye can use (038).

- Key: `PRIMARY KEY (id)`
- References: `(source_conversation_id) REFERENCES chat_conversations(id) ON DELETE SET NULL`

<details><summary>Columns (9)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `question` | text | no |  |  |
| `answer` | text | no |  |  |
| `category` | text | no | `'general'::text` |  |
| `source_conversation_id` | uuid | yes |  |  |
| `is_published` | boolean | no | `false` |  |
| `view_count` | integer | no | `0` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### chat_messages

*table · domain: agent · created by `037-chat-history` · RLS **on***

Ubunye chat messages (037).

- Key: `PRIMARY KEY (id)`
- References: `(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE`
- Checks: `chat_messages_role_check`: `CHECK ((role = ANY (ARRAY['user', 'assistant', 'system', 'tool'])))`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `conversation_id` | uuid | no |  |  |
| `role` | text | no |  |  |
| `content` | text | yes |  |  |
| `tool_calls` | jsonb | yes |  |  |
| `entities` | jsonb | yes |  |  |
| `agent_id` | text | yes |  |  |
| `model` | text | yes |  |  |
| `input_tokens` | integer | yes |  |  |
| `output_tokens` | integer | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### consent_records

*table · domain: accounts · created by `068-consent-records` · RLS **on***

Append-only POPIA / terms acceptances and withdrawals per document version (068).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Checks: `consent_records_lengths_check`: `CHECK ((((ip_hash IS NULL) OR (char_length(ip_hash) <= 128)) AND ((user_agent IS NULL) OR (char_length(user_agent) <= 512))))`; `consent_records_purpose_check`: `CHECK ((consent_purpose = ANY (ARRAY['terms', 'privacy', 'biometric', 'rental_agreement', 'owner_terms'])))`; `consent_records_purpose_source_check`: `CHECK ((((source = 'signup') AND (consent_purpose = ANY (ARRAY['terms', 'privacy']))) OR ((source = 'oauth_onboarding') AND (consent_purpose = ANY (ARRAY['terms', 'privacy']))) OR ((source = 'checkout') AND (consent_purpose = ANY (ARRAY['terms', 'privacy', 'rental_agreement']))) OR ((source = 'verification') AND (consent_purpose = ANY (ARRAY['biometric', 'privacy']))) OR ((source = 'listing') AND (consent_purpose = ANY (ARRAY['owner_terms', 'terms', 'privacy'])))))`; `consent_records_source_check`: `CHECK ((source = ANY (ARRAY['signup', 'oauth_onboarding', 'checkout', 'verification', 'listing'])))`; `consent_records_version_check`: `CHECK ((document_version ~ '^[0-9]{4}[-.][0-9]{2}[-.][0-9]{2}$'))`; `consent_records_withdrawn_check`: `CHECK (((withdrawn_at IS NULL) OR (withdrawn_at >= accepted_at)))`

<details><summary>Columns (9)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `consent_purpose` | text | no |  |  |
| `document_version` | text | no |  |  |
| `accepted_at` | timestamp with time zone | no | `now()` |  |
| `withdrawn_at` | timestamp with time zone | yes |  |  |
| `source` | text | no |  |  |
| `ip_hash` | text | yes |  |  |
| `user_agent` | text | yes |  |  |

</details>

### content_embeddings

*table · domain: agent · created by `001-pgvector-gemini` · RLS **on***

RAG embeddings of catalogue content (001-pgvector-gemini); unused while `RAG_ENABLED=false`.

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (content_type, content_id)`

<details><summary>Columns (7)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `content_type` | text | no |  |  |
| `content_id` | uuid | no |  |  |
| `content_text` | text | yes |  |  |
| `embedding` | vector | no |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |

</details>

### crew_requests

*table · domain: services · created by `007-crew-system` · RLS **on***

Legacy crew request flow (Ubunye "book a creator" before `bookings`). Clients read by e-mail, creators by id, writes by the server (007, 011, 013, 077).

- Key: `PRIMARY KEY (id)`
- References: `(creator_id) REFERENCES profiles(id)`
- Referenced by: `reviews`
- Checks: `crew_requests_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'contacted', 'confirmed', 'declined', 'completed', 'cancelled', 'paid', 'in_progress', 'expired'])))`

<details><summary>Columns (23)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `creator_id` | uuid | no |  |  |
| `client_name` | text | no |  |  |
| `client_email` | text | no |  |  |
| `client_phone` | text | yes |  |  |
| `project_type` | text | no |  |  |
| `preferred_dates` | text | yes |  |  |
| `description` | text | no |  |  |
| `budget_range` | text | yes |  |  |
| `location` | text | yes |  |  |
| `duration` | text | yes |  |  |
| `status` | text | no | `'pending'::text` |  |
| `admin_notes` | text | yes |  |  |
| `commission_rate` | integer | yes | `15` |  |
| `total_amount` | integer | yes |  | rands (whole) |
| `commission_amount` | integer | yes |  | rands (whole) |
| `booked_via` | text | yes | `'ubunye'::text` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `payment_id` | text | yes |  |  |
| `quoted_rate` | numeric | yes |  | rands |
| `estimated_hours` | numeric | yes |  |  |
| `deposit_amount` | numeric | yes |  | rands |

</details>

### delivery_addresses

*table · domain: delivery · created by `076-delivery` · RLS **on***

Verified delivery addresses and driver contact. The person and the server only (076). Since 080 also an owner's private **pickup address** (`purpose = 'owner_pickup'`): one active row per owner, read by that owner only (staff through the audited reveal, renters never; D-88).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- Referenced by: `delivery_quotes`, `delivery_shipments`
- Unique (080): `uq_delivery_addresses_active_owner_pickup` on `(user_id) WHERE purpose = 'owner_pickup' AND retired_at IS NULL AND redacted_at IS NULL`
- Checks: `delivery_addresses_lat_check`: `CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision)))`; `delivery_addresses_lng_check`: `CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision)))`; `delivery_addresses_purpose_check` (080): `CHECK ((purpose = ANY (ARRAY['renter_address', 'owner_handover', 'platform_site', 'owner_pickup'])))`; `delivery_addresses_owner_pickup_has_owner` (080): `CHECK (((purpose <> 'owner_pickup') OR (user_id IS NOT NULL)))`

<details><summary>Columns (19)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | yes |  |  |
| `purpose` | text | no |  |  |
| `formatted_address` | text | no |  |  |
| `suburb` | text | yes |  |  |
| `city` | text | yes |  |  |
| `province` | text | yes |  |  |
| `postal_code` | text | yes |  |  |
| `lat` | double precision | no |  |  |
| `lng` | double precision | no |  |  |
| `contact_name` | text | no |  |  |
| `contact_phone` | text | no |  |  |
| `instructions` | text | yes |  |  |
| `verified_by` | text | no |  |  |
| `verified_at` | timestamp with time zone | no | `now()` |  |
| `retain_until` | timestamp with time zone | yes |  |  |
| `redacted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `retired_at` | timestamp with time zone | yes |  |  |

`retired_at` (080): an owner pickup address the owner replaced or removed; retention purges it once nothing live uses it (an active one is never purged).

</details>

### delivery_cancelled_order_notes

*table · domain: delivery · created by `076-delivery` · RLS **on***

Settlement notes for cancelled orders with delivery (076).

- Key: `PRIMARY KEY (booking_group_id)`
- Checks: `delivery_cancelled_order_notes_attempts_check`: `CHECK ((attempts >= 0))`

<details><summary>Columns (6)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `booking_group_id` | uuid | no |  |  |
| `attempts` | integer | no | `0` |  |
| `last_attempt_at` | timestamp with time zone | yes |  |  |
| `staff_hold` | text | yes |  |  |
| `held_at` | timestamp with time zone | yes |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_custody_events

*table · domain: delivery · created by `076-delivery` · RLS **on***

Per-item chain of custody, append-only (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `delivery_custody_events_actor_kind_check`: `CHECK ((actor_kind = ANY (ARRAY['owner', 'thabangvision_staff', 'courier', 'renter', 'system'])))`; `delivery_custody_events_kind_check`: `CHECK ((kind = ANY (ARRAY['handed_to_courier', 'collected_by_courier', 'delivered_to_renter', 'renter_accepted', 'renter_reported_exception', 'deemed_accepted', 'staff_confirmed_received', 'handed_to_return_courier', 'received_by_owner', 'inspected'])))`

<details><summary>Columns (18)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no | `nextval('delivery_custody_events_id_s...` |  |
| `shipment_id` | uuid | no |  |  |
| `booking_group_id` | uuid | no |  |  |
| `booking_id` | uuid | no |  |  |
| `rental_id` | uuid | no |  |  |
| `serial_number` | text | yes |  |  |
| `kind` | text | no |  |  |
| `actor_kind` | text | no |  |  |
| `actor_id` | text | yes |  |  |
| `occurred_at` | timestamp with time zone | no |  |  |
| `recorded_at` | timestamp with time zone | no | `now()` |  |
| `evidence` | jsonb | no | `'[]'::jsonb` |  |
| `accessories` | jsonb | no | `'[]'::jsonb` |  |
| `serial_confirmed` | boolean | no | `false` |  |
| `condition` | text | yes |  |  |
| `discrepancies` | jsonb | no | `'[]'::jsonb` |  |
| `incident_id` | uuid | yes |  |  |
| `dedupe_key` | text | no |  |  |

</details>

### delivery_dispatch_intents

*table · domain: delivery · created by `076-delivery` · RLS **on***

Durable dispatch intent per shipment, claimed by compare-and-set (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (idempotency_key)`; `UNIQUE (merchant_reference)`; `UNIQUE (shipment_id)`
- Checks: `delivery_dispatch_intents_state_check`: `CHECK ((state = ANY (ARRAY['pending', 'claimed', 'succeeded', 'unknown', 'rejected'])))`

<details><summary>Columns (12)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `shipment_id` | uuid | no |  |  |
| `merchant_reference` | text | no |  |  |
| `idempotency_key` | text | no |  |  |
| `provider` | text | no |  |  |
| `state` | text | no | `'pending'::text` |  |
| `attempts` | integer | no | `0` |  |
| `claimed_at` | timestamp with time zone | yes |  |  |
| `last_error` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_events

*table · domain: delivery · created by `076-delivery` · RLS **on***

Canonical delivery state changes, append-only (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `delivery_events_source_check`: `CHECK ((source = ANY (ARRAY['provider_webhook', 'provider_poll', 'staff', 'system', 'renter', 'owner'])))`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no | `nextval('delivery_events_id_seq'::reg...` |  |
| `shipment_id` | uuid | no |  |  |
| `from_status` | text | no |  |  |
| `to_status` | text | no |  |  |
| `source` | text | no |  |  |
| `actor_id` | text | yes |  |  |
| `dedupe_key` | text | yes |  |  |
| `provider_state` | text | yes |  |  |
| `occurred_at` | timestamp with time zone | no |  |  |
| `recorded_at` | timestamp with time zone | no | `now()` |  |
| `note` | text | yes |  |  |

</details>

### delivery_incidents

*table · domain: delivery · created by `076-delivery` · RLS **on***

Lost / damaged / delayed / failed-attempt incidents (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `delivery_incidents_kind_check`: `CHECK ((kind = ANY (ARRAY['lost', 'damaged', 'stolen', 'delayed', 'failed_attempt', 'driver_no_show'])))`; `delivery_incidents_leg_check`: `CHECK ((leg = ANY (ARRAY['outbound', 'return'])))`; `delivery_incidents_liability_check`: `CHECK ((liability = ANY (ARRAY['undetermined', 'provider', 'renter', 'owner', 'platform', 'none'])))`; `delivery_incidents_reported_by_kind_check`: `CHECK ((reported_by_kind = ANY (ARRAY['provider', 'staff', 'renter', 'owner', 'system'])))`; `delivery_incidents_status_check`: `CHECK ((status = ANY (ARRAY['open', 'investigating', 'resolved', 'closed'])))`

<details><summary>Columns (19)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no |  |  |
| `shipment_id` | uuid | no |  |  |
| `booking_group_id` | uuid | no |  |  |
| `booking_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `leg` | text | no |  |  |
| `kind` | text | no |  |  |
| `status` | text | no | `'open'::text` |  |
| `provider_caused` | boolean | yes |  |  |
| `liability` | text | no | `'undetermined'::text` |  |
| `reported_by_kind` | text | no |  |  |
| `reported_by_id` | text | yes |  |  |
| `description` | text | no | `''::text` |  |
| `evidence` | jsonb | no | `'[]'::jsonb` |  |
| `dedupe_key` | text | no |  |  |
| `resolution` | text | yes |  |  |
| `resolved_by` | uuid | yes |  |  |
| `resolved_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_manual_tasks

*table · domain: delivery · created by `076-delivery` · RLS **on***

Own-vehicle dispatch as a staff task (076).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (merchant_reference)`; `UNIQUE (provider_reference)`
- Checks: `delivery_manual_tasks_leg_check`: `CHECK ((leg = ANY (ARRAY['outbound', 'return'])))`

<details><summary>Columns (12)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `merchant_reference` | text | no |  |  |
| `provider_reference` | text | no |  |  |
| `leg` | text | no |  |  |
| `state` | text | no | `'pending'::text` |  |
| `window_start` | timestamp with time zone | yes |  |  |
| `window_end` | timestamp with time zone | yes |  |  |
| `item_count` | integer | no | `1` |  |
| `assigned_to` | uuid | yes |  |  |
| `cancel_reason` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_proofs

*table · domain: delivery · created by `076-delivery` · RLS **on***

Evidence references (photos, signatures), append-only (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (shipment_id, kind, ref)`
- Checks: `delivery_proofs_kind_check`: `CHECK ((kind = ANY (ARRAY['pin', 'signature', 'photo', 'scan', 'provider_confirmation', 'renter_acceptance'])))`; `delivery_proofs_source_check`: `CHECK ((source = ANY (ARRAY['provider', 'staff', 'renter', 'owner'])))`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no | `nextval('delivery_proofs_id_seq'::reg...` |  |
| `shipment_id` | uuid | no |  |  |
| `booking_id` | uuid | yes |  |  |
| `kind` | text | no |  |  |
| `ref` | text | no |  |  |
| `source` | text | no |  |  |
| `captured_at` | timestamp with time zone | no |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_provider_events

*table · domain: delivery · created by `076-delivery` · RLS **on***

Courier webhook inbox (076).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `delivery_provider_events_processing_status_check`: `CHECK ((processing_status = ANY (ARRAY['received', 'processing', 'processed', 'failed', 'dead', 'ignored'])))`; `delivery_provider_events_signature_verified_check`: `CHECK (signature_verified)`

<details><summary>Columns (16)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `provider` | text | no |  |  |
| `provider_event_id` | text | yes |  |  |
| `dedupe_key` | text | no |  |  |
| `event_type` | text | no |  |  |
| `merchant_reference` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |
| `payload` | jsonb | no |  |  |
| `signature_verified` | boolean | no |  |  |
| `received_at` | timestamp with time zone | no | `now()` |  |
| `processed_at` | timestamp with time zone | yes |  |  |
| `processing_status` | text | no | `'received'::text` |  |
| `retry_count` | integer | no | `0` |  |
| `next_attempt_at` | timestamp with time zone | no | `now()` |  |
| `last_error` | text | yes |  |  |
| `outcome` | text | yes |  |  |

</details>

### delivery_quotes

*table · domain: delivery · created by `076-delivery` · RLS **on***

Expiring delivery quotes; provider cost and customer fee kept apart (076). `origin_owner_id uuid` (080, nullable): null = our site, else the owner whose pickup address is the gear's end of the leg (outbound origin, return destination).

- Key: `PRIMARY KEY (id)`
- References: `(destination_address_id) REFERENCES delivery_addresses(id)`; `(origin_address_id) REFERENCES delivery_addresses(id)`
- Referenced by: `delivery_shipments`
- Checks: `delivery_quotes_check`: `CHECK ((customer_fee_cents = (provider_cost_cents + platform_fee_cents)))`; `delivery_quotes_customer_fee_cents_check`: `CHECK ((customer_fee_cents >= 0))`; `delivery_quotes_leg_check`: `CHECK ((leg = ANY (ARRAY['outbound', 'return'])))`; `delivery_quotes_platform_fee_cents_check`: `CHECK ((platform_fee_cents >= 0))`; `delivery_quotes_provider_cost_cents_check`: `CHECK ((provider_cost_cents >= 0))`; `delivery_quotes_provider_kind_check`: `CHECK ((provider_kind = ANY (ARRAY['courier', 'own_fleet'])))`; `delivery_quotes_quote_amount_cents_check`: `CHECK ((quote_amount_cents >= 0))`; `delivery_quotes_replacement_value_cents_check`: `CHECK ((replacement_value_cents >= 0))`; `delivery_quotes_status_check`: `CHECK ((status = ANY (ARRAY['active', 'paid', 'consumed', 'expired', 'superseded', 'refunded'])))`

<details><summary>Columns (26)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `renter_id` | uuid | no |  |  |
| `booking_group_id` | uuid | yes |  |  |
| `leg` | text | no |  |  |
| `provider` | text | no |  |  |
| `provider_kind` | text | no |  |  |
| `provider_quote_ref` | text | yes |  |  |
| `quote_amount_cents` | integer | no |  | cents |
| `provider_cost_cents` | integer | no |  | cents |
| `platform_fee_cents` | integer | no | `0` | cents |
| `customer_fee_cents` | integer | no |  | cents |
| `replacement_value_cents` | bigint | no | `0` | cents |
| `booking_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `rental_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `origin_address_id` | uuid | no |  |  |
| `destination_address_id` | uuid | no |  |  |
| `window_start` | timestamp with time zone | yes |  |  |
| `window_end` | timestamp with time zone | yes |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `status` | text | no | `'active'::text` |  |
| `paid_reference` | text | yes |  |  |
| `paid_at` | timestamp with time zone | yes |  |  |
| `line_snapshot` | jsonb | no | `'[]'::jsonb` |  |
| `requested_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### delivery_reconciliation

*table · domain: delivery · created by `076-delivery` · RLS **on***

Provider invoice vs what was booked (076).

- Key: `PRIMARY KEY (id)`
- References: `(shipment_id) REFERENCES delivery_shipments(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (shipment_id, provider_invoice_ref)`
- Checks: `delivery_reconciliation_invoiced_cents_check`: `CHECK ((invoiced_cents >= 0))`; `delivery_reconciliation_status_check`: `CHECK ((status = ANY (ARRAY['matched', 'over', 'under'])))`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `shipment_id` | uuid | no |  |  |
| `provider` | text | no |  |  |
| `provider_invoice_ref` | text | no |  |  |
| `quoted_cents` | integer | no |  | cents |
| `accrued_cents` | integer | no |  | cents |
| `invoiced_cents` | integer | no |  | cents |
| `difference_cents` | integer | no |  | cents |
| `status` | text | no |  |  |
| `checked_at` | timestamp with time zone | no | `now()` |  |
| `checked_by` | uuid | yes |  |  |

</details>

### delivery_shipments

*table · domain: delivery · created by `076-delivery` · RLS **on***

One row per order, leg, **origin** (080) and attempt (076). `origin_owner_id uuid` (080, nullable, not granted to clients): null = our site, else the owner whose pickup address is the gear's end of the leg.

- Key: `PRIMARY KEY (id)`
- References: `(destination_address_id) REFERENCES delivery_addresses(id)`; `(origin_address_id) REFERENCES delivery_addresses(id)`; `(quote_id) REFERENCES delivery_quotes(id)`
- Referenced by: `delivery_custody_events`, `delivery_dispatch_intents`, `delivery_events`, `delivery_incidents`, `delivery_proofs`, `delivery_reconciliation`
- Unique: `UNIQUE (merchant_reference)`; (080) `uq_delivery_shipments_leg_origin_attempt` on `(booking_group_id, leg, coalesce(origin_owner_id, '00000000-…'), attempt)` and `uq_delivery_shipments_live_leg_origin` on `(booking_group_id, leg, coalesce(origin_owner_id, '00000000-…')) WHERE status NOT IN ('cancelled', 'failed')` (replace 076's `UNIQUE (booking_group_id, leg, attempt)` and `uq_delivery_shipments_live_leg`)
- Checks: `delivery_shipments_accrued_cost_cents_check`: `CHECK ((accrued_cost_cents >= 0))`; `delivery_shipments_attempt_check`: `CHECK ((attempt >= 1))`; `delivery_shipments_customer_fee_cents_check`: `CHECK ((customer_fee_cents >= 0))`; `delivery_shipments_leg_check`: `CHECK ((leg = ANY (ARRAY['outbound', 'return'])))`; `delivery_shipments_platform_fee_cents_check`: `CHECK ((platform_fee_cents >= 0))`; `delivery_shipments_provider_cost_cents_check`: `CHECK (((provider_cost_cents IS NULL) OR (provider_cost_cents >= 0)))`; `delivery_shipments_provider_kind_check`: `CHECK ((provider_kind = ANY (ARRAY['courier', 'own_fleet'])))`; `delivery_shipments_quote_amount_cents_check`: `CHECK ((quote_amount_cents >= 0))`; `delivery_shipments_replacement_value_cents_check`: `CHECK ((replacement_value_cents >= 0))`; `delivery_shipments_status_check`: `CHECK ((status = ANY (ARRAY['requested', 'quoted', 'prepared', 'booking', 'scheduled', 'courier_assigned', 'courier_at_pickup', 'collected', 'in_transit', 'courier_at_dropoff', 'delivered', 'cancelled', 'failed', 'delivery_attempt_failed', 'return_to_sender', 'lost', 'damaged', 'incident_under_review'])))`

<details><summary>Columns (38)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `booking_group_id` | uuid | no |  |  |
| `leg` | text | no |  |  |
| `attempt` | integer | no |  |  |
| `renter_id` | uuid | no |  |  |
| `owner_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `items` | jsonb | no |  |  |
| `booking_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `equipment_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `provider` | text | no |  |  |
| `provider_kind` | text | no |  |  |
| `quote_id` | uuid | no |  |  |
| `merchant_reference` | text | no |  |  |
| `provider_reference` | text | yes |  |  |
| `status` | text | no | `'prepared'::text` |  |
| `quote_amount_cents` | integer | no |  | cents |
| `customer_fee_cents` | integer | no |  | cents |
| `platform_fee_cents` | integer | no | `0` | cents |
| `accrued_cost_cents` | integer | no | `0` | cents |
| `provider_cost_cents` | integer | yes |  | cents |
| `replacement_value_cents` | bigint | no | `0` | cents |
| `coverage_verified` | boolean | no | `false` |  |
| `insurance_reference` | text | yes |  |  |
| `tracking_reference` | text | yes |  |  |
| `tracking_url` | text | yes |  |  |
| `courier_name` | text | yes |  |  |
| `origin_address_id` | uuid | no |  |  |
| `destination_address_id` | uuid | no |  |  |
| `window_start` | timestamp with time zone | yes |  |  |
| `window_end` | timestamp with time zone | yes |  |  |
| `scheduled_at` | timestamp with time zone | yes |  |  |
| `collected_at` | timestamp with time zone | yes |  |  |
| `delivered_at` | timestamp with time zone | yes |  |  |
| `accepted_at` | timestamp with time zone | yes |  |  |
| `last_provider_state_at` | timestamp with time zone | yes |  |  |
| `paid_reference` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### dispute_comments

*table · domain: rentals · created by `20260411000004_disputes` · RLS **on***

Comments on disputes (April migration 4). Server only.

- Key: `PRIMARY KEY (id)`
- References: `(dispute_id) REFERENCES disputes(id) ON DELETE CASCADE`

<details><summary>Columns (7)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `dispute_id` | uuid | no |  |  |
| `author_id` | uuid | no |  |  |
| `comment` | text | no |  |  |
| `attachments` | jsonb | yes | `'[]'::jsonb` |  |
| `is_internal` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### disputes

*table · domain: rentals · created by `20260411000004_disputes` · RLS **on***

Damage / return disputes on bookings, opened through `open_return_dispute` (April migration 4, 070).

- Key: `PRIMARY KEY (id)`
- Referenced by: `dispute_comments`
- Checks: `disputes_dispute_type_check`: `CHECK ((dispute_type = ANY (ARRAY['gear_damage', 'gear_not_returned', 'creator_no_show', 'client_cancellation', 'quality_dispute', 'payment_dispute'])))`; `disputes_resolution_check`: `CHECK ((resolution = ANY (ARRAY['full_refund', 'partial_refund', 'deposit_forfeit', 'warning_issued', 'user_suspended', 'no_action', 'custom'])))`; `disputes_status_check`: `CHECK ((status = ANY (ARRAY['open', 'investigating', 'resolved', 'escalated', 'dismissed'])))`

<details><summary>Columns (17)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `dispute_type` | text | no |  |  |
| `booking_id` | uuid | yes |  |  |
| `equipment_booking_id` | uuid | yes |  |  |
| `filed_by` | uuid | no |  |  |
| `filed_at` | timestamp with time zone | no | `now()` |  |
| `reason` | text | no |  |  |
| `evidence_photos` | jsonb | yes | `'[]'::jsonb` |  |
| `evidence_notes` | text | yes |  |  |
| `status` | text | no | `'open'::text` |  |
| `resolution` | text | yes |  |  |
| `resolution_amount` | numeric | yes |  | rands |
| `resolution_notes` | text | yes |  |  |
| `resolved_by` | uuid | yes |  |  |
| `resolved_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### equipment_bookings

*table · domain: rentals · created by `20260311000000_base_schema` · RLS **on***

One line per hired item per checkout (`checkout_group_id`). Dates, prices, deposit, hold expiry, handover / return / inspection state (base, 055, 062, 064, 070).

- Key: `PRIMARY KEY (id)`
- References: `(rental_id) REFERENCES smart_rentals(id) ON DELETE CASCADE`; `(user_id) REFERENCES profiles(id) ON DELETE RESTRICT`
- Referenced by: `booking_payments`, `invoices`, `owner_payouts`, `rental_escalations`
- Checks: `equipment_bookings_cancel_reason_check`: `CHECK (((cancel_reason IS NULL) OR (cancel_reason = ANY (ARRAY['hold_expired', 'customer', 'staff', 'payment_failed', 'identity_failed', 'unavailable']))))`; `equipment_bookings_cancellation_refund_status_check`: `CHECK (((cancellation_refund_status IS NULL) OR (cancellation_refund_status = ANY (ARRAY['pending', 'refunded', 'failed', 'not_required']))))`; `equipment_bookings_cents_check`: `CHECK ((((hire_cents IS NULL) OR (hire_cents >= 0)) AND ((deposit_cents IS NULL) OR (deposit_cents >= 0)) AND ((owner_share_cents IS NULL) OR (owner_share_cents >= 0)) AND ((platform_share_cents IS NULL) OR (platform_share_cents >= 0)) AND ((unit_replacement_value_cents IS NULL) OR (unit_replacement_value_cents >= 0))))`; `equipment_bookings_condition_at_checkout_check`: `CHECK ((condition_at_checkout = ANY (ARRAY['new', 'like_new', 'good', 'fair', 'for_parts'])))`; `equipment_bookings_condition_at_return_check`: `CHECK ((condition_at_return = ANY (ARRAY['new', 'like_new', 'good', 'fair', 'for_parts'])))`; `equipment_bookings_delivery_needs_address_check`: `CHECK (((fulfilment_method IS DISTINCT FROM 'delivery') OR ((delivery_address IS NOT NULL) AND (delivery_fee IS NOT NULL))))`; `equipment_bookings_fulfilment_method_check`: `CHECK (((fulfilment_method IS NULL) OR (fulfilment_method = ANY (ARRAY['collection', 'delivery']))))`; `equipment_bookings_inspection_outcome_check`: `CHECK (((inspection_outcome IS NULL) OR (inspection_outcome = ANY (ARRAY['clean', 'damage', 'missing_parts', 'late', 'not_returned']))))`; `equipment_bookings_ownership_check`: `CHECK (((ownership IS NULL) OR (ownership = ANY (ARRAY['studio', 'community']))))`; `equipment_bookings_payment_method_check`: `CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['eft', 'cash', 'online']))))`; `equipment_bookings_payment_plan_check`: `CHECK (((payment_plan IS NULL) OR (payment_plan = ANY (ARRAY['full', 'deposit_only']))))`; `equipment_bookings_quantity_positive`: `CHECK ((quantity >= 1))`; `equipment_bookings_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'confirmed', 'active', 'return_pending', 'return_reviewed', 'completed', 'cancelled', 'overdue', 'disputed'])))`; `valid_date_range`: `CHECK ((end_date >= start_date))`

<details><summary>Columns (63)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `rental_id` | uuid | no |  |  |
| `start_date` | date | no |  |  |
| `end_date` | date | no |  |  |
| `total_price` | numeric | no |  | rands |
| `deposit_amount` | numeric | yes |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `status` | text | yes | `'pending'::text` |  |
| `notes` | text | yes |  |  |
| `payfast_payment_id` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `cancelled_at` | timestamp with time zone | yes |  |  |
| `checkout_group_id` | uuid | yes |  |  |
| `condition_at_checkout` | text | yes |  |  |
| `condition_at_return` | text | yes |  |  |
| `checkout_photos` | jsonb | yes | `'[]'::jsonb` |  |
| `return_photos` | jsonb | yes | `'[]'::jsonb` |  |
| `return_notes` | text | yes |  |  |
| `returned_at` | timestamp with time zone | yes |  |  |
| `deposit_released` | numeric | yes | `0` | rands |
| `deposit_released_at` | timestamp with time zone | yes |  |  |
| `late_fee` | numeric | yes | `0` | rands |
| `return_reviewed_by` | uuid | yes |  |  |
| `return_reviewed_at` | timestamp with time zone | yes |  |  |
| `dispute_reason` | text | yes |  |  |
| `disputed_at` | timestamp with time zone | yes |  |  |
| `fulfilment_method` | text | yes |  |  |
| `payment_plan` | text | yes |  |  |
| `delivery_address` | text | yes |  |  |
| `delivery_lat` | double precision | yes |  |  |
| `delivery_lng` | double precision | yes |  |  |
| `delivery_distance_km` | numeric | yes |  |  |
| `delivery_fee` | numeric | yes |  | rands |
| `balance_due` | numeric | yes |  |  |
| `cancellation_refund_amount` | numeric | yes |  | rands |
| `cancellation_fee` | numeric | yes |  | rands |
| `cancellation_refund_percent` | integer | yes |  |  |
| `cancellation_refund_status` | text | yes |  |  |
| `cancellation_refund_error` | text | yes |  |  |
| `cancellation_refunded_at` | timestamp with time zone | yes |  |  |
| `quantity` | integer | no | `1` |  |
| `handover` | jsonb | yes |  |  |
| `damage_fee` | numeric | no | `0` | rands |
| `deposit_refund_method` | text | yes |  |  |
| `payment_method` | text | yes |  |  |
| `amount_due` | numeric | yes |  | rands |
| `hold_expires_at` | timestamp with time zone | yes |  |  |
| `cancel_reason` | text | yes |  |  |
| `hire_cents` | integer | yes |  | cents |
| `deposit_cents` | integer | yes |  | cents |
| `owner_share_cents` | integer | yes |  | cents |
| `platform_share_cents` | integer | yes |  | cents |
| `unit_replacement_value_cents` | bigint | yes |  | cents |
| `ownership` | text | yes |  |  |
| `owner_id` | uuid | yes |  |  |
| `inspection_outcome` | text | yes |  |  |
| `return_evidence` | jsonb | yes |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |
| `requires_manual_approval` | boolean | no | `false` |  |
| `payment_provider` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |

</details>

### feature_flag_events

*table · domain: admin · created by `030-feature-flags` · RLS **on***

Audit of flag toggles, by trigger (030).

- Key: `PRIMARY KEY (id)`
- References: `(changed_by) REFERENCES auth.users(id)`; `(flag_key) REFERENCES feature_flags(key) ON DELETE CASCADE`

<details><summary>Columns (6)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `flag_key` | text | no |  |  |
| `old_value` | boolean | yes |  |  |
| `new_value` | boolean | yes |  |  |
| `changed_by` | uuid | yes |  |  |
| `changed_at` | timestamp with time zone | no | `now()` |  |

</details>

### feature_flags

*table · domain: admin · created by `030-feature-flags` · RLS **on***

Feature flags; public read, admin write (030).

- Key: `PRIMARY KEY (key)`
- References: `(updated_by) REFERENCES auth.users(id)`
- Referenced by: `feature_flag_events`

<details><summary>Columns (5)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `key` | text | no |  |  |
| `enabled` | boolean | no | `false` |  |
| `description` | text | yes |  |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `updated_by` | uuid | yes |  |  |

</details>

### invoices

*table · domain: payments · created by `20260311000000_base_schema` · RLS **on***

Invoice records for gear bookings (base schema).

- Key: `PRIMARY KEY (id)`
- References: `(booking_id) REFERENCES equipment_bookings(id) ON DELETE CASCADE`
- Unique: `UNIQUE (invoice_number)`
- Checks: `invoices_status_check`: `CHECK ((status = ANY (ARRAY['draft', 'sent', 'paid', 'overdue', 'cancelled'])))`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `booking_id` | uuid | no |  |  |
| `invoice_number` | text | no |  |  |
| `amount` | numeric | no |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `status` | text | yes | `'draft'::text` |  |
| `pdf_url` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### ledger_journals

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

Double-entry journal headers; idempotent by key; append-only (070).

- Key: `PRIMARY KEY (id)`
- Referenced by: `ledger_lines`
- Unique: `UNIQUE (idempotency_key)`

<details><summary>Columns (7)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `idempotency_key` | text | no |  |  |
| `kind` | text | no |  |  |
| `booking_group_id` | uuid | yes |  |  |
| `memo` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | text | no | `CURRENT_USER` |  |

</details>

### ledger_lines

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

Double-entry lines in cents; balanced per journal; append-only (070).

- Key: `PRIMARY KEY (id)`
- References: `(journal_id) REFERENCES ledger_journals(id)`
- Checks: `ledger_lines_account_check`: `CHECK ((account = ANY (ARRAY['cash_at_provider', 'unearned_hire', 'customer_deposits', 'refunds_payable', 'owner_payable', 'unallocated_receipts', 'rental_revenue', 'platform_commission', 'delivery_income', 'damage_income', 'late_fee_income', 'cancellation_income', 'provider_fees', 'chargebacks', 'courier_costs', 'delivery_payable'])))`; `ledger_lines_check`: `CHECK (((debit_cents = 0) <> (credit_cents = 0)))`; `ledger_lines_credit_cents_check`: `CHECK ((credit_cents >= 0))`; `ledger_lines_debit_cents_check`: `CHECK ((debit_cents >= 0))`

<details><summary>Columns (5)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no | `nextval('ledger_lines_id_seq'::regclass)` |  |
| `journal_id` | uuid | no |  |  |
| `account` | text | no |  |  |
| `debit_cents` | bigint | no | `0` | cents |
| `credit_cents` | bigint | no | `0` | cents |

</details>

### listing_private

*table · domain: rentals · created by `072-listing-review` · RLS **on***

Owner-only and review data for a gear listing: serial number, replacement value, review notes (072).

- Key: `PRIMARY KEY (rental_id)`
- References: `(rental_id) REFERENCES smart_rentals(id) ON DELETE CASCADE`

<details><summary>Columns (10)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `rental_id` | uuid | no |  |  |
| `review_notes` | text | yes |  |  |
| `reviewed_by` | uuid | yes |  |  |
| `reviewed_at` | timestamp with time zone | yes |  |  |
| `submitted_at` | timestamp with time zone | yes |  |  |
| `ai_fields` | jsonb | yes |  |  |
| `owner_attestations` | jsonb | yes |  |  |
| `replacement_value_evidence` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `owner_pickup` | boolean | no | `false` |  |

`owner_pickup` (080, D-86): the owner offers this listing for collection from (and return to) their own pickup address. Written by the server only (`PATCH /api/delivery/owner-pickup`); it does not bump `updated_at` (which versions listing edits).

</details>

### listings

*table · domain: marketplace · created by `20260311000000_base_schema` · RLS **on***

Peer-to-peer marketplace listings (sell / rent / service). Owners write their own rows with the user session.

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- Referenced by: `orders`
- Unique: `UNIQUE (slug)`
- Checks: `listings_condition_check`: `CHECK (((condition = ANY (ARRAY['new', 'like_new', 'good', 'fair', 'for_parts'])) OR (condition IS NULL)))`; `listings_pricing_model_check`: `CHECK ((pricing_model = ANY (ARRAY['fixed', 'hourly', 'daily', 'weekly', 'monthly', 'negotiable'])))`; `listings_type_check`: `CHECK ((type = ANY (ARRAY['sell', 'rent', 'service'])))`

<details><summary>Columns (23)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `type` | text | no |  |  |
| `title` | text | no |  |  |
| `slug` | text | no |  |  |
| `description` | text | yes |  |  |
| `price` | numeric | yes |  | rands |
| `pricing_model` | text | yes | `'fixed'::text` |  |
| `currency` | text | yes | `'ZAR'::text` |  |
| `category` | text | yes |  |  |
| `sub_category` | text | yes |  |  |
| `thumbnail_url` | text | yes |  |  |
| `cover_public_id` | text | yes |  |  |
| `gallery` | jsonb | yes | `'[]'::jsonb` |  |
| `location` | text | yes |  |  |
| `condition` | text | yes |  |  |
| `is_published` | boolean | yes | `false` |  |
| `is_featured` | boolean | yes | `false` |  |
| `tags` | text[] | yes | `'{}'::text[]` |  |
| `features` | text[] | yes | `'{}'::text[]` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | yes |  |  |

</details>

### moderation_log

*table · domain: admin · created by `20260411000001_user_suspension` · RLS **on***

Admin moderation actions: suspend, reinstate, warn, remove listing (April migration 1). Server only.

- Key: `PRIMARY KEY (id)`
- References: `(admin_id) REFERENCES profiles(id)`; `(user_id) REFERENCES profiles(id)`
- Checks: `moderation_log_action_check`: `CHECK ((action = ANY (ARRAY['suspended', 'reinstated', 'warning_issued', 'listing_removed', 'verification_rejected'])))`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `action` | text | no |  |  |
| `reason` | text | no |  |  |
| `admin_id` | uuid | no |  |  |
| `dispute_id` | uuid | yes |  |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### newsletter_subscribers

*table · domain: content · created by `017-newsletter-subscribers` · RLS **on***

Newsletter sign-ups; server only (017, 044).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (email)`

<details><summary>Columns (4)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `email` | text | no |  |  |
| `subscribed_at` | timestamp with time zone | yes | `now()` |  |
| `unsubscribed_at` | timestamp with time zone | yes |  |  |

</details>

### notification_outbox

*table · domain: platform · created by `070-gear-pipeline` · RLS **on***

Durable outbox for e-mail / in-app notices, claimed with a lease (070).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `notification_outbox_channel_check`: `CHECK ((channel = ANY (ARRAY['in_app', 'email', 'sms'])))`; `notification_outbox_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'sending', 'sent', 'failed', 'dead', 'skipped'])))`

<details><summary>Columns (14)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `dedupe_key` | text | no |  |  |
| `kind` | text | no |  |  |
| `channel` | text | no |  |  |
| `user_id` | text | no |  |  |
| `booking_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `data` | jsonb | no | `'{}'::jsonb` |  |
| `status` | text | no | `'pending'::text` |  |
| `attempts` | integer | no | `0` |  |
| `send_after` | timestamp with time zone | yes |  |  |
| `claimed_at` | timestamp with time zone | yes |  |  |
| `sent_at` | timestamp with time zone | yes |  |  |
| `last_error` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### notifications

*table · domain: platform · created by `010-notifications` · RLS **on***

In-app notifications per user; the user reads and marks them read; the server creates them (010, 052, 065).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- Checks: `notifications_type_check`: `CHECK ((type = ANY (ARRAY['booking_accepted', 'booking_admin_cancelled', 'booking_admin_completed', 'booking_assigned', 'booking_cancelled', 'booking_completed', 'booking_confirmed', 'booking_delivered', 'booking_expired', 'booking_reassigned', 'booking_rejected', 'cart_reminder', 'creator_arrived', 'dispute_comment', 'dispute_filed', 'dispute_updated', 'gear_awaiting_payment', 'gear_collect_tomorrow', 'gear_confirmed', 'gear_not_returned', 'gear_payment_released', 'gear_payment_reminder', 'gear_return_tomorrow', 'gear_settled', 'gig_cancelled', 'gig_completed', 'gig_confirmed', 'gig_declined', 'gig_expired', 'gig_paid', 'gig_request', 'gig_unassigned', 'listing_approved', 'listing_rejected', 'listing_suspended', 'payment_confirmed', 'payment_received', 'payout_complete', 'payout_completed', 'payout_initiated', 'payout_processing', 'rental_booking_confirmed', 'rental_collection_reminder', 'rental_dispute_opened', 'rental_dispute_resolved', 'rental_handover_completed', 'rental_inspection_completed', 'rental_late_payment_refund', 'rental_overdue', 'rental_overdue_reminder', 'rental_payment_received', 'rental_payout_completed', 'rental_payout_failed', 'rental_payout_scheduled', 'rental_refund_failed', 'rental_refund_initiated', 'rental_refund_processed', 'rental_return_pending', 'rental_return_recorded', 'rental_return_reminder', 'rental_return_reviewed', 'rental_staff_alert', 'work_delivered', 'gig_revision_requested', 'rental_delivery_quote_ready', 'rental_delivery_booked', 'rental_delivery_courier_assigned', 'rental_delivery_courier_at_pickup', 'rental_delivery_collected', 'rental_delivery_in_transit', 'rental_delivery_delivered', 'rental_delivery_attempt_failed', 'rental_delivery_return_reminder', 'rental_delivery_return_courier_assigned', 'rental_delivery_return_collected', 'rental_delivery_returned_for_inspection', 'rental_delivery_incident', 'rental_delivery_cancelled', 'rental_delivery_fee_refund', 'rental_owner_pickup_scheduled', 'rental_owner_pickup_collected', 'rental_owner_gear_returned'])))` (the last three added by 080)

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `type` | text | no |  |  |
| `title` | text | no |  |  |
| `body` | text | no |  |  |
| `link` | text | yes |  |  |
| `is_read` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

</details>

### onboarding_progress

*table · domain: services · created by `20260411000003_onboarding` · RLS **on***

Where a creator is in the onboarding steps, and what the AI detected (April migration 3, 029).

- Key: `PRIMARY KEY (id)`
- References: `(creator_id) REFERENCES profiles(id)`
- Unique: `UNIQUE (creator_id)`

<details><summary>Columns (15)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `creator_id` | uuid | yes |  |  |
| `current_step` | integer | yes | `1` |  |
| `step_1_complete` | boolean | yes | `false` |  |
| `step_2_complete` | boolean | yes | `false` |  |
| `step_3_complete` | boolean | yes | `false` |  |
| `step_4_complete` | boolean | yes | `false` |  |
| `step_5_complete` | boolean | yes | `false` |  |
| `detected_skills` | jsonb | yes |  |  |
| `detected_gear` | jsonb | yes |  |  |
| `suggested_rates` | jsonb | yes |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `step_6_complete` | boolean | yes | `false` |  |

</details>

### ops_check_runs

*table · domain: platform · created by `053-ops-observability` · RLS **on***

Every invariant sweep run (053).

- Key: `PRIMARY KEY (id)`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `check_id` | text | no |  |  |
| `started_at` | timestamp with time zone | no | `now()` |  |
| `finished_at` | timestamp with time zone | yes |  |  |
| `duration_ms` | integer | yes |  |  |
| `findings_count` | integer | yes |  |  |
| `error` | text | yes |  |  |
| `run_source` | text | no | `'cron'::text` |  |

</details>

### ops_findings

*table · domain: platform · created by `053-ops-observability` · RLS **on***

Invariant findings from the daily sweep (053).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (fingerprint)`
- Checks: `ops_findings_resolution_source_check`: `CHECK ((resolution_source = ANY (ARRAY['auto', 'agent', 'human'])))`; `ops_findings_severity_check`: `CHECK ((severity = ANY (ARRAY['info', 'warn', 'critical'])))`; `ops_findings_status_check`: `CHECK ((status = ANY (ARRAY['open', 'acknowledged', 'resolved', 'muted', 'wont_fix'])))`

<details><summary>Columns (18)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `fingerprint` | text | no |  |  |
| `check_id` | text | no |  |  |
| `severity` | text | no |  |  |
| `entity_type` | text | yes |  |  |
| `entity_id` | text | yes |  |  |
| `title` | text | no |  |  |
| `detail` | jsonb | no | `'{}'::jsonb` |  |
| `observed_value` | numeric | yes |  |  |
| `threshold` | numeric | yes |  |  |
| `status` | text | no | `'open'::text` |  |
| `first_seen_at` | timestamp with time zone | no | `now()` |  |
| `last_seen_at` | timestamp with time zone | no | `now()` |  |
| `seen_count` | integer | no | `1` |  |
| `last_notified_at` | timestamp with time zone | yes |  |  |
| `muted_until` | timestamp with time zone | yes |  |  |
| `resolved_at` | timestamp with time zone | yes |  |  |
| `resolution_source` | text | yes |  |  |

</details>

### orders

*table · domain: marketplace · created by `20260311000000_base_schema` · RLS **on***

Marketplace orders between buyer and seller. Read by the parties; status changed through `/api/orders/[id]`; nothing creates them from a client.

- Key: `PRIMARY KEY (id)`
- References: `(buyer_id) REFERENCES profiles(id) ON DELETE RESTRICT`; `(listing_id) REFERENCES listings(id) ON DELETE CASCADE`; `(seller_id) REFERENCES profiles(id) ON DELETE RESTRICT`
- Referenced by: `reviews`
- Checks: `orders_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed', 'refunded'])))`

<details><summary>Columns (13)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `buyer_id` | uuid | no |  |  |
| `seller_id` | uuid | no |  |  |
| `listing_id` | uuid | no |  |  |
| `status` | text | yes | `'pending'::text` |  |
| `total` | numeric | no |  | rands |
| `platform_fee` | numeric | no |  | rands |
| `seller_payout` | numeric | no |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `payfast_payment_id` | text | yes |  |  |
| `notes` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### owner_payouts

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

Gear-owner payouts, one per booking, with commission and provider fee (070).

- Key: `PRIMARY KEY (id)`
- References: `(booking_id) REFERENCES equipment_bookings(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (booking_id)`; `UNIQUE (transfer_reference)`
- Checks: `owner_payouts_check`: `CHECK (((owner_amount_cents + platform_commission_cents) = gross_rental_amount_cents))`; `owner_payouts_gross_rental_amount_cents_check`: `CHECK ((gross_rental_amount_cents >= 0))`; `owner_payouts_owner_amount_cents_check`: `CHECK ((owner_amount_cents > 0))`; `owner_payouts_platform_commission_cents_check`: `CHECK ((platform_commission_cents >= 0))`; `owner_payouts_state_check`: `CHECK ((state = ANY (ARRAY['scheduled', 'held', 'approved', 'claimed', 'pending', 'otp', 'received', 'success', 'failed', 'reversed', 'blocked', 'rejected', 'abandoned', 'needs_attention'])))`

<details><summary>Columns (23)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `booking_id` | uuid | no |  |  |
| `owner_id` | uuid | no |  |  |
| `booking_group_id` | uuid | yes |  |  |
| `gross_rental_amount_cents` | integer | no |  | cents |
| `platform_commission_cents` | integer | no |  | cents |
| `owner_amount_cents` | integer | no |  | cents |
| `provider_fee_cents` | integer | yes |  | cents |
| `provider` | text | no | `'paystack'::text` |  |
| `transfer_reference` | text | no |  |  |
| `recipient_code` | text | yes |  |  |
| `provider_transfer_code` | text | yes |  |  |
| `state` | text | no | `'scheduled'::text` |  |
| `hold_reasons` | text[] | no | `'{}'::text[]` |  |
| `scheduled_at` | timestamp with time zone | no |  |  |
| `approved_at` | timestamp with time zone | yes |  |  |
| `approved_by` | uuid | yes |  |  |
| `claimed_at` | timestamp with time zone | yes |  |  |
| `processed_at` | timestamp with time zone | yes |  |  |
| `completed_at` | timestamp with time zone | yes |  |  |
| `last_error` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### payment_confirmations

*table · domain: payments · created by `061-payment-confirmations` · RLS **on***

One row per confirmed provider reference: dedupe and audit for confirmations (061).

- Key: `PRIMARY KEY (reference)`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `reference` | text | no |  |  |
| `provider` | text | no |  |  |
| `payment_id` | text | yes |  |  |
| `amount` | numeric | no | `0` | rands |
| `status` | text | no |  |  |
| `event_type` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### payment_events

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

Durable webhook inbox, claimed by workers (070).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (dedupe_key)`
- Checks: `payment_events_processing_status_check`: `CHECK ((processing_status = ANY (ARRAY['received', 'processing', 'processed', 'failed', 'dead', 'ignored'])))`

<details><summary>Columns (14)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `provider` | text | no |  |  |
| `provider_event_id` | text | yes |  |  |
| `dedupe_key` | text | no |  |  |
| `event_type` | text | no |  |  |
| `provider_reference` | text | yes |  |  |
| `payload` | jsonb | no |  |  |
| `received_at` | timestamp with time zone | no | `now()` |  |
| `processed_at` | timestamp with time zone | yes |  |  |
| `processing_status` | text | no | `'received'::text` |  |
| `retry_count` | integer | no | `0` |  |
| `next_attempt_at` | timestamp with time zone | no | `now()` |  |
| `last_error` | text | yes |  |  |
| `outcome` | text | yes |  |  |

</details>

### payment_reference_mismatches

*view · domain: payments · created by `071-provider-neutral-payments` · runs as owner (bypasses RLS)*

View: rows whose provider-neutral reference disagrees with the legacy column (071). Must be empty.


<details><summary>Columns (4)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `table_name` | text | yes |  |  |
| `id` | uuid | yes |  |  |
| `legacy_reference` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |

</details>

### phone_codes

*table · domain: accounts · created by `063-shoot-timeline-and-phone` · RLS **on***

Hashed one-time phone verification codes (063). Server only.

- Key: `PRIMARY KEY (user_id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE CASCADE`

<details><summary>Columns (7)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `user_id` | uuid | no |  |  |
| `phone` | text | no |  |  |
| `code_hash` | text | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `attempts` | integer | no | `0` |  |
| `sent_count` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### platform_events

*table · domain: platform · created by `021-platform-events` · RLS **on***

First-party analytics and security-denied events (021).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES auth.users(id)`

<details><summary>Columns (8)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `event_type` | text | no |  |  |
| `event_category` | text | no |  |  |
| `user_id` | uuid | yes |  |  |
| `session_id` | text | yes |  |  |
| `page_url` | text | yes |  |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

</details>

### portfolio_analysis

*table · domain: services · created by `20260411000003_onboarding` · RLS **on***

AI scene analysis of a creator's portfolio photos, used by the bio writer and rate suggestions (April migration 3).

- Key: `PRIMARY KEY (id)`
- References: `(creator_id) REFERENCES profiles(id)`

<details><summary>Columns (10)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `creator_id` | uuid | yes |  |  |
| `photo_url` | text | no |  |  |
| `cloudinary_public_id` | text | yes |  |  |
| `scene_type` | text | yes |  |  |
| `lighting_setup` | text | yes |  |  |
| `quality_score` | integer | yes |  |  |
| `description` | text | yes |  |  |
| `hashtags` | text[] | yes |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

</details>

### portfolio_tag_corrections

*table · domain: services · created by `028-listings-ai-generated` · RLS **on***

Creator corrections to AI photo tags, kept as a training signal (028).

- Key: `PRIMARY KEY (id)`
- References: `(creator_id) REFERENCES profiles(id) ON DELETE CASCADE`

<details><summary>Columns (6)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `creator_id` | uuid | yes |  |  |
| `photo_url` | text | no |  |  |
| `original_tag` | text | no |  |  |
| `corrected_tag` | text | no |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### press

*table · domain: content · created by `20260311000000_base_schema` · RLS **on***

Press / blog articles (base schema).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (slug)`

<details><summary>Columns (15)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `title` | text | no |  |  |
| `slug` | text | no |  |  |
| `content` | text | yes |  |  |
| `excerpt` | text | yes |  |  |
| `cover_url` | text | yes |  |  |
| `cover_public_id` | text | yes |  |  |
| `author` | text | yes |  |  |
| `category` | text | yes |  |  |
| `published_at` | timestamp with time zone | yes |  |  |
| `is_published` | boolean | yes | `false` |  |
| `is_featured` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | yes |  |  |

</details>

### production_categories

*table · domain: services · created by `025-production-categories` · RLS **on***

Service categories with a starting rate (025, 026).

- Key: `PRIMARY KEY (id)`
- Referenced by: `smart_productions`
- Unique: `UNIQUE (slug)`

<details><summary>Columns (16)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `slug` | text | no |  |  |
| `name` | text | no |  |  |
| `description` | text | yes |  |  |
| `sub_types` | text[] | yes | `'{}'::text[]` |  |
| `cover_image_url` | text | yes |  |  |
| `cover_image_public_id` | text | yes |  |  |
| `starting_rate` | integer | no | `0` | rands (whole) |
| `starting_unit` | text | no | `'session'::text` |  |
| `project_type` | text | no |  |  |
| `creator_keywords` | text[] | yes | `'{}'::text[]` |  |
| `icon` | text | yes |  |  |
| `display_order` | integer | no | `0` |  |
| `is_published` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### profiles

*table · domain: accounts · created by `20260311000000_base_schema` · RLS **on***

One row per auth user (created by the signup trigger). Display data, address, creator settings, verification state and evidence paths, suspension. Clients never read other rows: the public projection is `public_profiles`. Privileged columns are locked by 067.

- Key: `PRIMARY KEY (id)`
- References: `(id) REFERENCES auth.users(id) ON DELETE CASCADE`; `(suspended_by) REFERENCES profiles(id)`
- Referenced by: `ai_token_usage`, `banking_details`, `bookings`, `cart_items`, `crew_requests`, `equipment_bookings`, `listings`, `moderation_log`, `notifications`, `onboarding_progress`, `orders`, `portfolio_analysis`, `portfolio_tag_corrections`, `profiles`, `rental_payment_intents`, `reviews`, `subscriptions`, `ubunye_usage`, `unmet_demand`
- Unique: `UNIQUE (crew_slug)`
- Checks: `chk_portfolio_max_3`: `CHECK ((jsonb_array_length(COALESCE(portfolio_projects, '[]'::jsonb)) <= 3))`; `profiles_role_check`: `CHECK ((role = ANY (ARRAY['user', 'admin', 'moderator'])))`; `profiles_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unverified', 'pending', 'verified', 'rejected'])))`

<details><summary>Columns (57)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no |  |  |
| `display_name` | text | yes |  |  |
| `bio` | text | yes |  |  |
| `avatar_url` | text | yes |  |  |
| `avatar_public_id` | text | yes |  |  |
| `skills` | text[] | yes | `'{}'::text[]` |  |
| `social_links` | jsonb | yes | `'{}'::jsonb` |  |
| `location` | text | yes |  |  |
| `phone` | text | yes |  |  |
| `is_verified` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `verification_status` | text | no | `'unverified'::text` |  |
| `verification_submitted_at` | timestamp with time zone | yes |  |  |
| `verification_reviewed_at` | timestamp with time zone | yes |  |  |
| `verification_rejected_reason` | text | yes |  |  |
| `id_front_path` | text | yes |  |  |
| `id_back_path` | text | yes |  |  |
| `role` | text | no | `'user'::text` |  |
| `available_for_hire` | boolean | yes | `false` |  |
| `hourly_rate` | integer | yes |  | rands (whole) |
| `specializations` | text[] | yes | `'{}'::text[]` |  |
| `crew_slug` | text | yes |  |  |
| `crew_bio` | text | yes |  |  |
| `years_experience` | integer | yes |  |  |
| `crew_featured` | boolean | yes | `false` |  |
| `selfie_with_id_path` | text | yes |  |  |
| `verification_metadata` | jsonb | yes |  |  |
| `verification_ai_check` | jsonb | yes |  |  |
| `verification_fraud_flags` | jsonb | yes | `'[]'::jsonb` |  |
| `id_document_hash` | text | yes |  |  |
| `verification_ip` | text | yes |  |  |
| `verification_user_agent` | text | yes |  |  |
| `verification_attempts` | integer | yes | `0` |  |
| `first_name` | text | yes |  |  |
| `last_name` | text | yes |  |  |
| `street_address` | text | yes |  |  |
| `city` | text | yes |  |  |
| `province` | text | yes |  |  |
| `postal_code` | text | yes |  |  |
| `country` | text | yes | `'South Africa'::text` |  |
| `address_lat` | double precision | yes |  |  |
| `address_lng` | double precision | yes |  |  |
| `address_place_id` | text | yes |  |  |
| `onboarding_completed_at` | timestamp with time zone | yes |  |  |
| `no_show_count` | integer | yes | `0` |  |
| `portfolio_projects` | jsonb | yes | `'[]'::jsonb` |  |
| `popia_consent_at` | timestamp with time zone | yes |  |  |
| `popia_consent_version` | text | yes |  |  |
| `popia_consent_ip` | inet | yes |  |  |
| `marketing_opt_in` | boolean | no | `false` |  |
| `is_suspended` | boolean | yes | `false` |  |
| `suspended_at` | timestamp with time zone | yes |  |  |
| `suspended_by` | uuid | yes |  |  |
| `suspension_reason` | text | yes |  |  |
| `suspension_expires_at` | timestamp with time zone | yes |  |  |
| `phone_verified_at` | timestamp with time zone | yes |  |  |

</details>

### public_profiles

*view · domain: accounts · created by `036-fix-profiles-rls-pii-exposure` · runs as owner (bypasses RLS)*

View. The only public projection of `profiles`: creators and owners of live listings, not suspended (077). Portfolio hidden until verified (075).


<details><summary>Columns (18)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | yes |  |  |
| `display_name` | text | yes |  |  |
| `avatar_url` | text | yes |  |  |
| `bio` | text | yes |  |  |
| `skills` | text[] | yes |  |  |
| `social_links` | jsonb | yes |  |  |
| `location` | text | yes |  |  |
| `specializations` | text[] | yes |  |  |
| `crew_slug` | text | yes |  |  |
| `crew_bio` | text | yes |  |  |
| `years_experience` | integer | yes |  |  |
| `crew_featured` | boolean | yes |  |  |
| `hourly_rate` | integer | yes |  | rands (whole) |
| `available_for_hire` | boolean | yes |  |  |
| `portfolio_projects` | jsonb | yes |  |  |
| `is_verified` | boolean | yes |  |  |
| `verification_status` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |

</details>

### rate_limits

*table · domain: platform · created by `054-durable-rate-limits` · RLS **on***

Fixed-window rate-limit counters (054).

- Key: `PRIMARY KEY (key, window_start)`

<details><summary>Columns (3)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `key` | text | no |  |  |
| `window_start` | timestamp with time zone | no |  |  |
| `count` | integer | no | `0` |  |

</details>

### refund_obligations

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

Money owed back to a customer, capped at the charge, claimed by one worker (070, 076).

- Key: `PRIMARY KEY (id)`
- Unique: `UNIQUE (obligation_key)`; `UNIQUE (provider_refund_id)`
- Checks: `refund_obligations_amount_cents_check`: `CHECK ((amount_cents > 0))`; `refund_obligations_charged_cents_check`: `CHECK ((charged_cents > 0))`; `refund_obligations_check`: `CHECK ((amount_cents <= charged_cents))`; `refund_obligations_reason_check`: `CHECK ((reason = ANY (ARRAY['deposit_settlement', 'cancellation', 'late_payment', 'overpayment', 'manual'])))`; `refund_obligations_state_check`: `CHECK ((state = ANY (ARRAY['eligible', 'claimed', 'requested', 'pending', 'processing', 'processed', 'failed', 'needs_attention', 'disputed'])))`

<details><summary>Columns (22)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `obligation_key` | text | no |  |  |
| `reason` | text | no |  |  |
| `state` | text | no | `'eligible'::text` |  |
| `amount_cents` | integer | no |  | cents |
| `charged_cents` | integer | no |  | cents |
| `transaction_reference` | text | no |  |  |
| `provider` | text | no | `'paystack'::text` |  |
| `provider_refund_id` | text | yes |  |  |
| `user_id` | uuid | yes |  |  |
| `booking_group_id` | uuid | yes |  |  |
| `booking_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `from_unallocated` | boolean | no | `false` |  |
| `ledgered` | boolean | no | `true` |  |
| `attempts` | integer | no | `0` |  |
| `claimed_at` | timestamp with time zone | yes |  |  |
| `last_error` | text | yes |  |  |
| `evidence` | jsonb | yes |  |  |
| `created_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `processed_at` | timestamp with time zone | yes |  |  |

</details>

### rental_blocks

*table · domain: rentals · created by `070-gear-pipeline` · RLS **on***

Units taken off sale for maintenance or loss (070).

- Key: `PRIMARY KEY (id)`
- References: `(rental_id) REFERENCES smart_rentals(id) ON DELETE CASCADE`
- Checks: `rental_blocks_check`: `CHECK (((ends_on IS NULL) OR (ends_on >= starts_on)))`; `rental_blocks_reason_check`: `CHECK ((reason = ANY (ARRAY['maintenance', 'inspection', 'repair', 'lost', 'other'])))`; `rental_blocks_units_check`: `CHECK ((units >= 1))`

<details><summary>Columns (10)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `rental_id` | uuid | no |  |  |
| `units` | integer | no | `1` |  |
| `starts_on` | date | no |  |  |
| `ends_on` | date | yes |  |  |
| `reason` | text | no |  |  |
| `note` | text | yes |  |  |
| `created_by` | uuid | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `lifted_at` | timestamp with time zone | yes |  |  |

</details>

### rental_escalations

*table · domain: rentals · created by `070-gear-pipeline` · RLS **on***

Late-return escalation stages per booking (070).

- Key: `PRIMARY KEY (id)`
- References: `(booking_id) REFERENCES equipment_bookings(id) ON DELETE CASCADE`
- Unique: `UNIQUE (booking_id, stage)`
- Checks: `rental_escalations_stage_check`: `CHECK ((stage = ANY (ARRAY['reminder', 'phone_follow_up', 'formal_escalation', 'senior_review'])))`

<details><summary>Columns (9)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `booking_id` | uuid | no |  |  |
| `stage` | text | no |  |  |
| `hours_late` | numeric | no |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `acted_by` | uuid | yes |  |  |
| `acted_at` | timestamp with time zone | yes |  |  |
| `outcome` | text | yes |  |  |
| `notes` | text | yes |  |  |

</details>

### rental_payment_intents

*table · domain: payments · created by `070-gear-pipeline` · RLS **on***

What the server expects to be paid for one gear checkout; moved to paid only by a verified provider event (070).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE RESTRICT`
- Unique: `UNIQUE (checkout_group_id)`; `UNIQUE (provider_transaction_id)`; `UNIQUE (reference)`
- Checks: `rental_payment_intents_check`: `CHECK ((((hire_cents + deposit_cents) + delivery_cents) = expected_amount_cents))`; `rental_payment_intents_currency_check`: `CHECK ((currency = 'ZAR'))`; `rental_payment_intents_delivery_cents_check`: `CHECK ((delivery_cents >= 0))`; `rental_payment_intents_deposit_cents_check`: `CHECK ((deposit_cents >= 0))`; `rental_payment_intents_expected_amount_cents_check`: `CHECK ((expected_amount_cents >= 0))`; `rental_payment_intents_hire_cents_check`: `CHECK ((hire_cents >= 0))`; `rental_payment_intents_state_check`: `CHECK ((state = ANY (ARRAY['initiated', 'paid', 'failed', 'expired', 'mismatch', 'refund_due', 'refunded'])))`

<details><summary>Columns (20)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `checkout_group_id` | uuid | no |  |  |
| `reference` | text | no |  |  |
| `provider` | text | no |  |  |
| `user_id` | uuid | no |  |  |
| `state` | text | no | `'initiated'::text` |  |
| `expected_amount_cents` | integer | no |  | cents |
| `hire_cents` | integer | no |  | cents |
| `deposit_cents` | integer | no |  | cents |
| `delivery_cents` | integer | no | `0` | cents |
| `currency` | text | no | `'ZAR'::text` |  |
| `provider_transaction_id` | text | yes |  |  |
| `hold_expires_at` | timestamp with time zone | no |  |  |
| `paid_at` | timestamp with time zone | yes |  |  |
| `failed_attempts` | integer | no | `0` |  |
| `mismatch_reason` | text | yes |  |  |
| `recovery_checked_at` | timestamp with time zone | yes |  |  |
| `recovery_closed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### reviews

*table · domain: marketplace · created by `20260311000000_base_schema` · RLS **on***

Reviews of creators, gear and orders (019 consolidates them). Public when published; written by the server.

- Key: `PRIMARY KEY (id)`
- References: `(order_id) REFERENCES orders(id)`; `(rental_id) REFERENCES smart_rentals(id)`; `(request_id) REFERENCES crew_requests(id)`; `(reviewee_id) REFERENCES profiles(id)`; `(reviewer_id) REFERENCES profiles(id)`
- Checks: `reviews_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`; `reviews_review_type_check`: `CHECK ((review_type = ANY (ARRAY['order', 'crew', 'rental'])))`

<details><summary>Columns (14)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `review_type` | text | no |  |  |
| `reviewer_id` | uuid | yes |  |  |
| `reviewer_name` | text | yes |  |  |
| `reviewer_email` | text | yes |  |  |
| `reviewee_id` | uuid | yes |  |  |
| `rental_id` | uuid | yes |  |  |
| `order_id` | uuid | yes |  |  |
| `request_id` | uuid | yes |  |  |
| `rating` | smallint | no |  |  |
| `comment` | text | yes |  |  |
| `is_published` | boolean | no | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

### security_audit_log

*table · domain: admin · created by `067-lock-sensitive-columns` · RLS **on***

Redacted record of trusted changes to privileged profile / banking columns (067). Service role only.

- Key: `PRIMARY KEY (id)`

<details><summary>Columns (10)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `occurred_at` | timestamp with time zone | no | `now()` |  |
| `actor` | uuid | yes |  |  |
| `actor_role` | text | yes |  |  |
| `db_role` | text | no | `CURRENT_USER` |  |
| `table_name` | text | no |  |  |
| `row_id` | text | yes |  |  |
| `operation` | text | no |  |  |
| `column_name` | text | no |  |  |
| `change_summary` | jsonb | no | `'{}'::jsonb` |  |

</details>

### service_booking_events

*table · domain: services · created by `073-service-fulfilment` · RLS **on***

Append-only history of a service booking: payment, acceptance, delivery, approval, refunds (073).

- Key: `PRIMARY KEY (id)`
- References: `(booking_id) REFERENCES bookings(id) ON DELETE CASCADE`
- Checks: `service_booking_events_actor_check`: `CHECK ((actor = ANY (ARRAY['client', 'creator', 'admin', 'system'])))`

<details><summary>Columns (9)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `booking_id` | uuid | no |  |  |
| `event` | text | no |  |  |
| `from_status` | text | yes |  |  |
| `to_status` | text | yes |  |  |
| `actor` | text | no |  |  |
| `actor_id` | uuid | yes |  |  |
| `reason` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### smart_productions

*table · domain: services · created by `20260311000000_base_schema` · RLS **on***

Production portfolio / creator production listings shown in the studio (base, 033, 035).

- Key: `PRIMARY KEY (id)`
- References: `(creator_id) REFERENCES auth.users(id)`; `(production_category_id) REFERENCES production_categories(id)`
- Unique: `UNIQUE (slug)`

<details><summary>Columns (27)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `slug` | text | no |  |  |
| `title` | text | no |  |  |
| `client` | text | yes |  |  |
| `year` | smallint | yes |  |  |
| `project_type` | text | yes |  |  |
| `sub_category` | text | yes |  |  |
| `description` | text | yes |  |  |
| `video_provider` | text | yes |  |  |
| `video_url` | text | yes |  |  |
| `tags` | text[] | yes | `'{}'::text[]` |  |
| `thumbnail_url` | text | yes |  |  |
| `cover_public_id` | text | yes |  |  |
| `gallery` | jsonb | yes | `'[]'::jsonb` |  |
| `is_published` | boolean | yes | `false` |  |
| `is_featured` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | yes |  |  |
| `image_metadata` | jsonb | yes | `'[]'::jsonb` |  |
| `crew_ids` | uuid[] | yes | `'{}'::uuid[]` |  |
| `production_category_id` | uuid | yes |  |  |
| `price` | integer | yes |  | rands (whole) |
| `currency` | text | no | `'ZAR'::text` |  |
| `creator_id` | uuid | yes |  |  |
| `price_unit` | text | no | `'project'::text` |  |
| `submitted_at` | timestamp with time zone | yes |  |  |

</details>

### smart_rentals

*table · domain: rentals · created by `20260311000000_base_schema` · RLS **on***

Gear for hire: studio stock and community (owner) listings. Public when published. Community listings go live through review (`listing_status`, 072).

- Key: `PRIMARY KEY (id)`
- References: `(owner_id) REFERENCES auth.users(id)`
- Referenced by: `cart_items`, `equipment_bookings`, `listing_private`, `rental_blocks`, `reviews`, `unmet_demand`
- Unique: `UNIQUE (slug)`
- Checks: `smart_rentals_category_check`: `CHECK ((category = ANY (ARRAY['cameras-optics', 'lighting-power', 'audio', 'grip-motion', 'data-storage', 'specialized-solutions', 'aerial-support', 'sound-reinforcement'])))`; `smart_rentals_listing_status_check`: `CHECK ((listing_status = ANY (ARRAY['draft', 'pending_review', 'published', 'rejected', 'suspended'])))`

<details><summary>Columns (41)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `slug` | text | no |  |  |
| `title` | text | no |  |  |
| `description` | text | yes |  |  |
| `category` | text | yes |  |  |
| `sub_category` | text | yes |  |  |
| `brand` | text | yes |  |  |
| `model` | text | yes |  |  |
| `price_per_day` | numeric | yes |  | rands |
| `price_per_week` | numeric | yes |  | rands |
| `deposit_amount` | numeric | yes |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `thumbnail_url` | text | yes |  |  |
| `cover_public_id` | text | yes |  |  |
| `gallery` | jsonb | yes | `'[]'::jsonb` |  |
| `is_available` | boolean | yes | `true` |  |
| `quantity` | integer | yes | `1` |  |
| `is_published` | boolean | yes | `false` |  |
| `is_featured` | boolean | yes | `false` |  |
| `is_archived` | boolean | yes | `false` |  |
| `tags` | text[] | yes | `'{}'::text[]` |  |
| `features` | text[] | yes | `'{}'::text[]` |  |
| `rental_includes` | text[] | yes | `'{}'::text[]` |  |
| `metadata` | jsonb | yes | `'{}'::jsonb` |  |
| `video_provider` | text | yes |  |  |
| `video_url` | text | yes |  |  |
| `video_id` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | yes |  |  |
| `owner_type` | text | yes | `'studio'::text` |  |
| `owner_id` | uuid | yes |  |  |
| `ranking_score` | numeric | yes | `0` |  |
| `total_rentals` | integer | yes | `0` |  |
| `average_rating` | numeric | yes | `0` |  |
| `review_count` | integer | yes | `0` |  |
| `is_ai_generated` | boolean | yes | `false` |  |
| `replacement_value` | numeric | yes |  | rands |
| `serial_number` | text | yes |  |  |
| `tracker_fitted` | boolean | no | `false` |  |
| `listing_status` | text | no | `'draft'::text` |  |

</details>

### subscription_plans

*table · domain: payments · created by `20260311000000_base_schema` · RLS **on***

Plan catalogue (Starter / Pro / Studio).

- Key: `PRIMARY KEY (id)`
- Referenced by: `subscriptions`
- Unique: `UNIQUE (slug)`
- Checks: `subscription_plans_interval_check`: `CHECK (("interval" = ANY (ARRAY['monthly', 'annual'])))`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `name` | text | no |  |  |
| `slug` | text | no |  |  |
| `description` | text | yes |  |  |
| `price` | numeric | no |  | rands |
| `currency` | text | yes | `'ZAR'::text` |  |
| `interval` | text | no |  |  |
| `features` | jsonb | yes | `'[]'::jsonb` |  |
| `payfast_plan_id` | text | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### subscriptions

*table · domain: payments · created by `20260311000000_base_schema` · RLS **on***

Creator plan subscriptions; the server writes them (059), with the expected price (069).

- Key: `PRIMARY KEY (id)`
- References: `(plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE`; `(user_id) REFERENCES profiles(id) ON DELETE RESTRICT`
- Checks: `subscriptions_billing_interval_check`: `CHECK (((billing_interval IS NULL) OR (billing_interval = ANY (ARRAY['monthly', 'annual']))))`; `subscriptions_currency_check`: `CHECK (((currency IS NULL) OR (currency = 'ZAR')))`; `subscriptions_expected_amount_cents_check`: `CHECK (((expected_amount_cents IS NULL) OR (expected_amount_cents >= 0)))`; `subscriptions_status_check`: `CHECK ((status = ANY (ARRAY['pending', 'active', 'cancelled', 'past_due', 'trialing', 'paused'])))`

<details><summary>Columns (13)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `plan_id` | uuid | no |  |  |
| `payfast_token` | text | yes |  |  |
| `status` | text | yes | `'active'::text` |  |
| `current_period_start` | timestamp with time zone | yes |  |  |
| `current_period_end` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `expected_amount_cents` | integer | yes |  | cents |
| `currency` | text | yes |  |  |
| `billing_interval` | text | yes |  |  |
| `provider_reference` | text | yes |  |  |

</details>

### ubunye_usage

*table · domain: agent · created by `039-ubunye-usage` · RLS **on***

Per-user daily message counts for agent rate limits (039).

- Key: `PRIMARY KEY (id)`
- References: `(user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- Unique: `UNIQUE (user_id, date)`

<details><summary>Columns (5)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `user_id` | uuid | no |  |  |
| `date` | date | no |  |  |
| `message_count` | integer | no | `0` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### unmet_demand

*table · domain: platform · created by `057-unmet-demand` · RLS **on***

Searches and checkouts the platform could not serve; aggregate only (057).

- Key: `PRIMARY KEY (id)`
- References: `(rental_id) REFERENCES smart_rentals(id) ON DELETE SET NULL`; `(user_id) REFERENCES profiles(id) ON DELETE SET NULL`
- Checks: `unmet_demand_kind_check`: `CHECK ((kind = ANY (ARRAY['search_no_results', 'unavailable_dates', 'not_in_catalogue'])))`

<details><summary>Columns (11)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |  |
| `kind` | text | no |  |  |
| `query` | text | no |  |  |
| `rental_id` | uuid | yes |  |  |
| `start_date` | date | yes |  |  |
| `end_date` | date | yes |  |  |
| `requested` | integer | yes |  |  |
| `available` | integer | yes |  |  |
| `user_id` | uuid | yes |  |  |
| `source` | text | no |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

</details>

### unmet_demand_summary

*view · domain: platform · created by `057-unmet-demand` · security_invoker*

View: unmet demand grouped by what was asked for (057). Service only (077).


<details><summary>Columns (6)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `kind` | text | yes |  |  |
| `query` | text | yes |  |  |
| `times` | bigint | yes |  |  |
| `people` | bigint | yes |  |  |
| `last_asked` | timestamp with time zone | yes |  |  |
| `first_asked` | timestamp with time zone | yes |  |  |

</details>

### welcome_messages

*table · domain: accounts · created by `060-welcome-messages` · RLS **on***

Drafted and sent welcome e-mails per new user (060), written by the signup webhook path. Admin read.

- Key: `PRIMARY KEY (user_id)`
- References: `(user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- Checks: `welcome_messages_status_check`: `CHECK ((status = ANY (ARRAY['draft', 'sending', 'sent', 'discarded'])))`

<details><summary>Columns (13)</summary>

| Column | Type | Null | Default | Money |
|---|---|---|---|---|
| `user_id` | uuid | no |  |  |
| `email` | text | yes |  |  |
| `first_name` | text | yes |  |  |
| `signup_method` | text | yes |  |  |
| `activity` | jsonb | no | `'{}'::jsonb` |  |
| `subject` | text | no |  |  |
| `body` | text | no |  |  |
| `drafted_by` | text | no |  |  |
| `status` | text | no | `'draft'::text` |  |
| `sent_by` | uuid | yes |  |  |
| `sent_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

</details>

## Auth and storage objects ThabangVision relies on

- `auth.users`: Supabase Auth's user list (shared with other apps in production; see [database-isolation](../operations/database-isolation.md)). Triggers: `on_auth_user_created` → `public.handle_new_user()` (creates the profile, 077) and `on_auth_user_created_notify` → `public.notify_signup()` (posts the new user id to the signup webhook stored in Vault, 060; never blocks sign-up).
- `auth.users.raw_app_meta_data.role = 'admin'`: the first of the three admin checks (`is_admin()`, `requireAdmin()`).
- `auth.users.raw_user_meta_data.intent`: what the person said they came to do (rent, hire, list, supply); user-editable, used only for routing and wording.
- `storage.buckets.verifications` (private) and its two `storage.objects` policies: a signed-in user may upload into and read from their own folder only; no update or delete (067). Other buckets are not used: media lives in Cloudinary.
- `vault.decrypted_secrets` `signup_webhook_url` / `signup_webhook_secret`, read by `notify_signup()`.

