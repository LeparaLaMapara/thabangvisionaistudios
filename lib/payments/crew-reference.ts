/**
 * Payment references for crew (creator) requests.
 *
 * Paystack refuses a reference it has seen before ("Duplicate Transaction
 * Reference"), so the bare request id worked for one attempt only: a second
 * try, or the full payment after a deposit, could not start. Each attempt now
 * gets its own reference, "<request id>.<kind><time>", which keeps to the
 * characters Paystack allows (letters, digits, "-", "." and "=") and still
 * leads back to the request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crewPaymentReference(requestId: string, kind: 'full' | 'deposit', now: Date = new Date()): string {
  return `${requestId}.${kind === 'deposit' ? 'd' : 'f'}${now.getTime().toString(36)}`;
}

/** The crew request id a payment reference belongs to; a bare id (older links) counts too. */
export function crewRequestIdFromReference(reference: string): string | null {
  const id = reference.split('.')[0];
  return UUID.test(id) ? id.toLowerCase() : null;
}
