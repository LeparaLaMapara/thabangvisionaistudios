# TASK-081: Close the PayFast and WhatsApp webhook gaps before switching them on
## Priority: HIGH before either is enabled | Found by the security test of 2026-10-13
## Files allowed: app/api/webhooks/payfast/route.ts, lib/payments/payfast.ts, lib/whatsapp/twilio.ts, their tests

Both paths are OFF in production today (PAYMENT_PROVIDER=paystack, Twilio not
configured), so neither is reachable. Do this task before setting
PAYMENT_PROVIDER=payfast or configuring Twilio. Details:
docs/security/2026-10-13-security-test.md (M4, M5).

## M4: PayFast webhook
`app/api/webhooks/payfast/route.ts:130-156`, `lib/payments/payfast.ts:72-118`.
1. Crew request branch: compare `amount_gross` with the stored `total_amount`
   (or `deposit_amount` for `crew_request_deposit`), in rands, and refuse a
   mismatch. Never write `total_amount = amountGross`.
2. Check `merchant_id` equals our `PAYFAST_MERCHANT_ID`: otherwise anyone can
   point their own PayFast notify_url at us.
3. Every status update adds `.eq('status', 'pending')` (or the right start
   status), so a cancelled booking cannot be revived by a late notification.
4. Require `PAYFAST_PASSPHRASE` (refuse to start without it), and keep the
   PayFast IP check on in sandbox too, or limit sandbox to non-production.
5. Tests: wrong amount, wrong merchant, cancelled booking, missing passphrase.

## M5: WhatsApp (Twilio) webhook fails open
`lib/whatsapp/twilio.ts:89-93`. With `TWILIO_WEBHOOK_URL` unset any non-empty
signature passes, and `From` is chosen by the caller, so AI replies (cost) go
to any number.
1. Fail closed: no `TWILIO_WEBHOOK_URL` or no auth token means every request
   is refused (401), with a log line.
2. Rate limit replies per `From` number and per hour overall.
3. Tests: unset URL refuses, bad signature refuses, good signature passes.

## Also open from the same test (not dormant, lower risk)
- L2: quote PDFs (`app/api/quotes/route.ts`) can be made with any client and
  prices by any signed-in user, with no rate limit. Add a rate limit and mark
  the PDF "Estimate, not an invoice", or limit it to creators and admins.
- Admin 2FA (Supabase MFA) for admin accounts, and leaked-password protection.
- JWT secret rotation (the legacy secret was printed in an agent's output).
