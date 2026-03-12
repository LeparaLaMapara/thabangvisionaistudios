# TASK-009: Abstraction - Payment Provider Layer
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: lib/payments/*, app/api/payfast/*, app/api/payments/*, app/api/webhooks/*, components/booking/BookingWidget.tsx, app/(platform)/pricing/page.tsx
## Description
Create payment abstraction layer. Wrap existing PayFast code.
## Acceptance criteria
- [ ] lib/payments/types.ts — PaymentProvider interface
- [ ] lib/payments/payfast.ts — implements using existing code
- [ ] lib/payments/paystack.ts — stub
- [ ] lib/payments/index.ts — reads PAYMENT_PROVIDER env
- [ ] Routes use abstraction, not direct PayFast
- [ ] PAYMENT_PROVIDER=payfast works
- [ ] npm run build passes
