/**
 * How customers pay while online card payment is off, said positively: what
 * to do, not what is missing. Browser-safe (lib/payments/offline.ts sends
 * email, so it is server-only).
 */

/** After a booking or shoot request is saved. */
export const PAYMENTS_OFF_MESSAGE =
  'Booking received. Pay by EFT to our business account, or in cash when you collect. Your booking page shows the amount, your reference and our bank details.';

/**
 * Said wherever a customer commits (item page, cart, /book, home, FAQ,
 * pricing) while online card payment is off. Shown only when
 * onlinePaymentsOpen() is false, so it goes away by itself when card
 * payment opens.
 */
export const PAYMENTS_NOT_OPEN_NOTICE =
  'Pay by EFT to our business account, or in cash when you collect. You get the bank details and your reference as soon as you book.';
