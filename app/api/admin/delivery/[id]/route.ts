export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { loadShipmentDetail } from '@/lib/delivery/ops';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One shipment for staff (spec Phase 4 §4.18): its events, per-item chain of
 * custody with evidence, proofs, incidents, reconciliation and (own fleet)
 * the driver task. No address, contact detail or tracking link: those are
 * revealed one side at a time through the logged `reveal_address` action.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 });
  try {
    const detail = await loadShipmentDetail(createAdminClient(), id);
    if (!detail) return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    console.error('[admin-delivery] detail failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load this delivery.' }, { status: 500 });
  }
}
