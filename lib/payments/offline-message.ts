/** Browser-safe copy of the "payments are off" message (lib/payments/offline.ts sends email, so it is server-only). */
export const PAYMENTS_OFF_MESSAGE =
  'Online payment is not open yet. Your request is saved and the team has been told; we will contact you to arrange payment.';

/**
 * Said wherever a customer commits (item page, cart, /book, home, FAQ,
 * pricing) while online payment is closed, so nobody learns it only after
 * pressing the button. Shown only when onlinePaymentsOpen() is false.
 */
export const PAYMENTS_NOT_OPEN_NOTICE =
  'Online card payment is not open yet. When you book, we contact you to confirm and arrange payment by EFT, cash or a card link.';
