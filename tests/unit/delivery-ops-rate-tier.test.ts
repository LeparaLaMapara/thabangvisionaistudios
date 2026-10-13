/**
 * Phase 5: one delivery is several staff taps in a minute. Progress records
 * count against the everyday admin limit; money, courier bookings, liability
 * and batch actions keep the strict one. Unknown or unreadable actions are
 * strict (fail closed), and a limited request runs nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { deliveryActionRateTier } from '@/lib/delivery/staff-rate-tier';

const state = vi.hoisted(() => ({ tiers: [] as string[], ranUseCase: 0 }));

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ user: { id: '00000000-0000-4000-8000-0000000000c1' }, error: null }),
  // Refuse every call, so the route must stop at the limit and touch nothing.
  rateLimitAdmin: async (_id: string, tier: string) => {
    state.tiers.push(tier);
    return NextResponse.json({ error: 'Rate limit exceeded. Please try again shortly.' }, { status: 429 });
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('the database must not be touched when rate limited');
  },
}));
vi.mock('@/lib/delivery/server', () => ({
  deliveryDeps: async () => {
    state.ranUseCase += 1;
    throw new Error('no use case may run when rate limited');
  },
}));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => ({ sent: 0, skipped: 0, failed: 0 }) }));

const post = async (body: unknown): Promise<Response> => {
  const { POST } = await import('@/app/api/admin/delivery/route');
  return POST(new NextRequest('http://localhost/api/admin/delivery', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
};

beforeEach(() => {
  state.tiers = [];
  state.ranUseCase = 0;
});

describe('deliveryActionRateTier', () => {
  it('puts recording what physically happened on the everyday limit', () => {
    for (const a of ['advance_manual', 'record_collection', 'record_handover', 'record_inspection', 'report_incident', 'reschedule', 'quote_leg']) {
      expect(deliveryActionRateTier({ action: a }), a).toBe('standard');
    }
  });

  it('keeps money, courier bookings, liability, address reveals and batches on the strict limit', () => {
    for (const a of ['dispatch', 'cancel', 'dispatch_manual_paid', 'reconcile_invoice', 'close_review', 'resolve_incident', 'run_jobs', 'requeue_event', 'reveal_address']) {
      expect(deliveryActionRateTier({ action: a }), a).toBe('sensitive');
    }
  });

  it('an incident that decides whether the provider caused it (waives the late fee) is strict', () => {
    expect(deliveryActionRateTier({ action: 'report_incident', providerCaused: true })).toBe('sensitive');
    expect(deliveryActionRateTier({ action: 'report_incident', providerCaused: false })).toBe('sensitive');
    // Anything else the route reads as "not decided" (null).
    expect(deliveryActionRateTier({ action: 'report_incident', providerCaused: null })).toBe('standard');
    expect(deliveryActionRateTier({ action: 'report_incident', providerCaused: 'yes' })).toBe('standard');
  });

  it('is strict for anything it does not know', () => {
    for (const b of [undefined, null, 42, 'advance_manual', {}, { action: '' }, { action: 'Advance_Manual' }, { action: 'refund_everything' }, { action: { action: 'advance_manual' } }]) {
      expect(deliveryActionRateTier(b)).toBe('sensitive');
    }
  });
});

describe('POST /api/admin/delivery applies the tier per action', () => {
  it('a progress record is limited on the standard bucket and runs nothing once limited', async () => {
    const res = await post({ action: 'advance_manual', shipmentId: '00000000-0000-4000-8000-000000000001', state: 'in_transit' });
    expect(res.status).toBe(429);
    expect(state.tiers).toEqual(['standard']);
    expect(state.ranUseCase).toBe(0);
  });

  it('a cancellation (money) is limited on the sensitive bucket', async () => {
    const res = await post({ action: 'cancel', shipmentId: '00000000-0000-4000-8000-000000000001', reason: 'x', initiatedBy: 'renter' });
    expect(res.status).toBe(429);
    expect(state.tiers).toEqual(['sensitive']);
    expect(state.ranUseCase).toBe(0);
  });

  it('an address reveal is limited on the sensitive bucket', async () => {
    const res = await post({ action: 'reveal_address', shipmentId: '00000000-0000-4000-8000-000000000001', side: 'dropoff' });
    expect(res.status).toBe(429);
    expect(state.tiers).toEqual(['sensitive']);
  });

  it('an incident with a provider-caused decision is limited on the sensitive bucket', async () => {
    const res = await post({ action: 'report_incident', shipmentId: '00000000-0000-4000-8000-000000000001', kind: 'late', providerCaused: true });
    expect(res.status).toBe(429);
    expect(state.tiers).toEqual(['sensitive']);
    expect(state.ranUseCase).toBe(0);
  });

  it('an unreadable body counts against the sensitive bucket', async () => {
    const res = await post('not json');
    expect(res.status).toBe(429);
    expect(state.tiers).toEqual(['sensitive']);
  });
});
