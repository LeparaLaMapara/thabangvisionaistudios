import { STUDIO } from '@/lib/constants';

/**
 * Paying by EFT (or cash at collection) while online card payment is off.
 * One place for the reference, the bank details and the WhatsApp link, so the
 * pay screen, /pay, the emails and the owner all show exactly the same thing.
 * Browser-safe: no server imports.
 */

export type OfflineMethod = 'eft' | 'cash';

/** The reference a customer puts on their EFT: short, readable, unique enough. */
export function paymentReference(orderId: string): string {
  return `TV-${orderId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export const BANK_LINES: readonly { label: string; value: string }[] = [
  { label: 'Account name', value: STUDIO.bank.accountName },
  { label: 'Bank', value: STUDIO.bank.bankName },
  { label: 'Account number', value: STUDIO.bank.accountNumber },
  { label: 'Branch code', value: STUDIO.bank.branchCode },
  { label: 'Account type', value: STUDIO.bank.accountType },
];

/** A wa.me link that opens WhatsApp to ThabangVision with a message ready to send. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${STUDIO.whatsapp.number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export const telLink = `tel:${STUDIO.phone.replace(/\s/g, '')}`;

/** The scam warning shown next to bank details. */
export const BANK_DETAILS_NEVER_CHANGE =
  'Our bank details never change. We will never send you new bank details by WhatsApp or email. Always check them on thabangvision.com/pay.';

/** Plain text block for emails. */
export function bankDetailsText(reference: string): string {
  return [
    ...BANK_LINES.map((l) => `${l.label}: ${l.value}`),
    `Reference: ${reference}`,
  ].join('\n');
}
