import { describe, it, expect } from 'vitest';
import { sanitiseFunnelMeta, funnelReport, RENTER_FUNNEL, isFunnelStage, CLIENT_FUNNEL_STAGES } from '@/lib/core/analytics/funnel';

describe('funnel metrics stay privacy-respecting', () => {
  it('keeps ids, codes and counts', () => {
    expect(sanitiseFunnelMeta({ rentalId: '9b2f1c3e-0000-4000-8000-000000000001', days: 3, code: 'trust_limit', codes: ['missing_phone', 'missing_bank'] }))
      .toEqual({ rentalId: '9b2f1c3e-0000-4000-8000-000000000001', days: 3, code: 'trust_limit', codes: ['missing_phone', 'missing_bank'] });
  });

  it('drops unknown keys and anything that looks personal', () => {
    const out = sanitiseFunnelMeta({
      email: 'a@b.co', phone: '+27 82 555 1234', name: 'Sipho', address: '12 Main Rd',
      source: 'someone@example.com', code: '0825551234', category: 'Sony FX3 camera', listingId: '8001015009087',
      bookingId: 'BK-abc123',
    });
    expect(out).toEqual({ bookingId: 'BK-abc123' });
  });

  it('conversion between stages', () => {
    const r = funnelReport(RENTER_FUNNEL.slice(0, 3), { rental_viewed: 200, dates_chosen: 50, rental_reserved: 0 });
    expect(r.map((x) => x.fromPrevious)).toEqual([null, 25, 0]);
    expect(funnelReport(RENTER_FUNNEL.slice(0, 2), { rental_viewed: 0, dates_chosen: 0 })[1].fromPrevious).toBeNull();
  });

  it('only viewing and choosing dates may be reported by a browser', () => {
    expect(CLIENT_FUNNEL_STAGES).toEqual(['rental_viewed', 'dates_chosen']);
    expect(isFunnelStage('payment_confirmed')).toBe(true);
    expect(isFunnelStage('drop table')).toBe(false);
  });
});
