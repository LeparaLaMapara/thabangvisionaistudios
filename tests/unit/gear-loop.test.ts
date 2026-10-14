import { describe, it, expect } from 'vitest';
import { STUDIO } from '@/lib/constants';
import { depositSettlement, lateFeeFor } from '@/lib/rental/late-fee';
import { gearNoticeText, type NoticeBooking } from '@/lib/rental/notices';
import { isManualReference, manualReference, refundPayment } from '@/lib/payments/routing';

describe('late fee', () => {
  it('nothing when returned on the due day, even late in the day', () => {
    expect(lateFeeFor({ endDate: '2026-10-03', returnedAt: new Date('2026-10-03T21:30:00+02:00'), deposit: 2000 }).fee).toBe(0);
  });
  it('R150 per item per day or part of a day after that', () => {
    const r = lateFeeFor({ endDate: '2026-10-03', returnedAt: new Date('2026-10-05T09:00:00+02:00'), quantity: 2, deposit: 5000 });
    expect(r.daysLate).toBe(2);
    expect(r.fee).toBe(600);
  });
  it('never more than the deposit', () => {
    expect(lateFeeFor({ endDate: '2026-10-01', returnedAt: new Date('2026-10-20T09:00:00+02:00'), deposit: 500 }).fee).toBe(500);
  });
});

describe('deposit settlement', () => {
  it('gives back what is left after late and damage charges', () => {
    expect(depositSettlement({ deposit: 3000, lateFee: 150, damageFee: 850 })).toEqual({ release: 2000, kept: 1000 });
  });
  it('keeps no more than the deposit', () => {
    expect(depositSettlement({ deposit: 1000, lateFee: 300, damageFee: 5000 })).toEqual({ release: 0, kept: 1000 });
  });
});

describe('messages to the renter', () => {
  const items: NoticeBooking[] = [{ id: 'b1', user_id: 'u', start_date: '2026-10-01', end_date: '2026-10-03', title: 'Sony FX3' }];
  it('the confirmation says where, when and to bring ID', () => {
    const t = gearNoticeText('confirmed', items);
    expect(t.body).toMatch(/Sony FX3, 2026-10-01 to 2026-10-03/);
    expect(t.body).toContain(STUDIO.fulfilment.dispatchFrom.meetingPoint);
    expect(t.body).toContain(STUDIO.fulfilment.dispatchFrom.name);
    expect(t.body).toMatch(/ID card/);
  });
  it('the settlement says how much comes back and how', () => {
    const t = gearNoticeText('settled', items, { depositBack: 2000, refundMethod: 'eft', kept: 1000 });
    expect(t.body).toMatch(/R2.000 is on its way back by EFT/);
    expect(t.body).toMatch(/R1.000 was kept/);
  });
});

describe('payments taken by hand', () => {
  it('are recognised and never sent to a payment provider for a refund', async () => {
    const ref = manualReference('eft', 'FNB 12345');
    expect(ref).toBe('manual:eft:FNB12345');
    expect(isManualReference(ref)).toBe(true);
    const r = await refundPayment(ref, 500);
    expect(r.success).toBe(false);
    expect(r.manual).toBe(true);
  });
});
