-- 069 — Subscriptions record the price the server expects (Phase 0, 2026-10-08)
--
-- WHY
--   POST /api/payfast/checkout now resolves the plan and price on the server
--   and inserts a 'pending' subscription carrying the expected amount, currency,
--   interval and a unique provider reference. The payment webhook
--   (lib/payments/fulfil.ts confirmSubscriptionPayment) activates the row only
--   if the amount, currency, reference, plan and user all match, and only once
--   (guarded pending -> active).
--
--   Two gaps made that impossible before:
--     1. The table had nowhere to store the expected amount or reference.
--     2. subscriptions_status_check did not allow 'pending', although both
--        initiation routes inserted it (verified on dev 2026-10-08:
--        CHECK (status IN ('active','cancelled','past_due','trialing','paused'))).
--
-- SAFE TO RERUN: every statement is IF NOT EXISTS / DROP ... IF EXISTS.
-- Existing rows are untouched: the new columns are nullable, and existing
-- active subscribers keep their current period and are never re-priced.
--
-- APPLY: dev first (with 067 and 068), then prod only after founder approval.

BEGIN;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS expected_amount_cents integer
    CHECK (expected_amount_cents IS NULL OR expected_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS currency text
    CHECK (currency IS NULL OR currency = 'ZAR'),
  ADD COLUMN IF NOT EXISTS billing_interval text
    CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS provider_reference text;

-- One subscription row per provider reference: a replayed initiation cannot
-- create a second pending row for the same payment.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_reference_key
  ON public.subscriptions (provider_reference)
  WHERE provider_reference IS NOT NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending', 'active', 'cancelled', 'past_due', 'trialing', 'paused'));

COMMIT;

-- ── ROLLBACK (manual) ────────────────────────────────────────────────────────
-- Only if no row uses status 'pending' and the new columns are unused:
--   BEGIN;
--   DELETE FROM public.subscriptions WHERE status = 'pending';   -- abandoned initiations only
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
--   ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
--     CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'paused'));
--   DROP INDEX IF EXISTS public.subscriptions_provider_reference_key;
--   ALTER TABLE public.subscriptions
--     DROP COLUMN IF EXISTS provider_reference,
--     DROP COLUMN IF EXISTS billing_interval,
--     DROP COLUMN IF EXISTS currency,
--     DROP COLUMN IF EXISTS expected_amount_cents;
--   COMMIT;
