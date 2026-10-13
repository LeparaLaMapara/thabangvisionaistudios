import { customAlphabet } from 'nanoid';

/**
 * Service booking references, also sent to Paystack as the transaction
 * reference. Paystack's API reference says only letters, digits, "-", "."
 * and "=" are allowed there; nanoid's default alphabet includes "_" (about
 * one reference in seven). Test mode accepted "_" on 2026-10-13, but the live
 * rule is the documented one, so references use letters and digits only.
 */
const id = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10);

export function newServiceBookingReference(): string {
  return `BK-${id()}`;
}
