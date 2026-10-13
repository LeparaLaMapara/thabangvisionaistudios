# TASK-083: Delivery updates by our own SMS and WhatsApp
## Priority: MEDIUM | Prepared 2026-10-14, switched OFF
## Files allowed: lib/sms/index.ts, lib/whatsapp/*, lib/core/rental/notifications.ts (NOTICE_CHANNELS), lib/rental/notify.ts, Vercel env

## Today (2026-10-14)
- Uber Direct texts the renter itself: the drop-off PIN when the delivery is
  booked, and again as the driver gets close (Uber's pincode guide). That
  needs SMS switched on in the Uber Direct account.
- Our site sends delivery updates by email, in-app, and phone push.
- Our own SMS is OFF: `SMS_PROVIDER` is not set on production, so the
  existing SMS rows (delivered, delivery failed, reminders) are skipped.

## What is ready
- `lib/sms/index.ts`: a BulkSMS sender (`SMS_PROVIDER=bulksms`), off until
  its token is set. It only sends to an international number (+27...).
- `lib/whatsapp/delivery-templates.ts`: four WhatsApp "Utility" templates
  (on the way, delivered, delivery failed, return pickup reminder). Nothing
  sends them yet.

## To switch on SMS (owner)
1. Open a BulkSMS account (bulksms.com), buy credits (prepaid, per message
   part; check the current South African price on their pricing page).
2. In BulkSMS, Settings, API Tokens: create a token.
3. Give the token id and secret to Claude. Claude sets on Vercel Production:
   `SMS_PROVIDER=bulksms`, `BULKSMS_TOKEN_ID`, `BULKSMS_TOKEN_SECRET`, then
   sends one test SMS to the owner's number.
4. Only verified phone numbers get SMS (profiles.phone_verified_at).

## To switch on WhatsApp (owner)
1. Verify the business with Meta (Business Manager, business verification:
   CIPC documents). Meta decides; it can take days.
2. Pick a sender: Meta's own WhatsApp Cloud API (cheapest, no middleman) or
   Twilio (already wired as `lib/whatsapp/twilio.ts`).
3. Submit the four templates in `lib/whatsapp/delivery-templates.ts` exactly
   as written, category Utility, language English. Wait for approval.
4. Claude then adds a `whatsapp` channel for those kinds and a sender, with
   the renter's consent recorded (WhatsApp needs opt-in).

## Done when
- One real SMS and one real WhatsApp reach the owner's phone from a test
  delivery on the preview.
- A renter without a verified phone gets no SMS, and nobody gets the same
  update twice (dedupe keys in notification_outbox).
