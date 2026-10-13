/**
 * Paystack refund events have no refund id and no `reference` (docs sample
 * payload: transaction_reference, refund_reference, amount). The inbox keyed
 * them on the charge alone, so a second partial refund of one charge was
 * dropped as a duplicate of the first.
 */
import { describe, expect, it } from 'vitest';
import { dedupeReference, parsePaystackEvent } from '@/lib/rental/inbox';
import { eventDedupeKey } from '@/lib/core/rental/payments';

const refund = (amount: number | string, refundRef: string | null, status = 'processed') =>
  JSON.stringify({
    event: `refund.${status}`,
    data: { status, transaction_reference: 'grp-1', refund_reference: refundRef, amount, currency: 'ZAR', customer: { email: 'x@example.com' } },
  });

const key = (body: string) => {
  const p = parsePaystackEvent(body)!;
  return eventDedupeKey('paystack', p.event, p.dataId, p.status, dedupeReference(p));
};

describe('refund event de-duplication', () => {
  it('two partial refunds of one charge are two events', () => {
    expect(key(refund(10000, 'RF1'))).not.toBe(key(refund(25000, 'RF2')));
    expect(key(refund(10000, null, 'pending'))).not.toBe(key(refund(25000, null, 'pending')));
  });
  it('a true repeat is still one event, and a string amount reads the same', () => {
    expect(key(refund(10000, 'RF1'))).toBe(key(refund(10000, 'RF1')));
    expect(key(refund('10000', 'RF1'))).toBe(key(refund(10000, 'RF1')));
  });
  it('never leaks customer details into the stored copy', () => {
    expect(JSON.stringify(parsePaystackEvent(refund(1, 'RF1'))!.minimal)).not.toContain('example.com');
  });
  it('charge and transfer events keep their own reference', () => {
    const charge = parsePaystackEvent(JSON.stringify({ event: 'charge.success', data: { id: 1, reference: 'BK-1', amount: 100 } }))!;
    expect(dedupeReference(charge)).toBe('BK-1');
    const transfer = parsePaystackEvent(JSON.stringify({ event: 'transfer.success', data: { reference: 'tvsp_x', transfer_code: 'TRF_1' } }))!;
    expect(dedupeReference(transfer)).toBe('tvsp_x');
  });
});
