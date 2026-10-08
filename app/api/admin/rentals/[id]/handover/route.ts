export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { AGREEMENT_VERSION, handoverAgreement } from '@/lib/rental/agreement';
import { logEvent } from '@/lib/data/events';
import { isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { buildNotices } from '@/lib/core/rental/notifications';
import { dispatchOutbox } from '@/lib/rental/notify';

/**
 * The in-person handover (TASK-067). GET loads what staff need at the counter:
 * the booking, the renter, their ID selfie if it is still kept (ID images are
 * deleted 30 days after review), and the agreement to sign. POST records the
 * handover and puts the booking out on hire.
 */

const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
const MAX_SIGNATURE_CHARS = 300_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from('equipment_bookings')
    .select('id, user_id, status, start_date, end_date, deposit_amount, quantity, fulfilment_method, handover, smart_rentals(title, serial_number, tracker_fitted)')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Risk flag, read separately so a database without the column (migration not
  // applied yet) still loads the handover; a missing column means no flag.
  const risk = await admin.from('equipment_bookings').select('requires_manual_approval').eq('id', id).maybeSingle();
  const requiresManualApproval =
    !risk.error && (risk.data as { requires_manual_approval?: boolean | null } | null)?.requires_manual_approval === true;

  const { data: profile } = await admin
    .from('profiles')
    .select('first_name, last_name, display_name, verification_status, selfie_with_id_path')
    .eq('id', booking.user_id)
    .maybeSingle();

  let selfieUrl: string | null = null;
  if (profile?.selfie_with_id_path) {
    const { data } = await admin.storage.from('verifications').createSignedUrl(profile.selfie_with_id_path, 900);
    selfieUrl = data?.signedUrl ?? null;
  }

  const rental = (Array.isArray(booking.smart_rentals) ? booking.smart_rentals[0] : booking.smart_rentals) as
    | { title: string; serial_number: string | null; tracker_fitted: boolean | null }
    | null;
  const renterName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.display_name || 'the renter';

  return NextResponse.json({
    booking: {
      id: booking.id,
      status: booking.status,
      start_date: booking.start_date,
      end_date: booking.end_date,
      deposit_amount: booking.deposit_amount,
      quantity: booking.quantity,
      fulfilment_method: booking.fulfilment_method,
      handover: booking.handover,
      requires_manual_approval: requiresManualApproval,
    },
    rental,
    renter: { name: renterName, verification: profile?.verification_status ?? 'none', selfieUrl },
    agreement: {
      version: AGREEMENT_VERSION,
      lines: handoverAgreement({
        renterName,
        reference: booking.id.slice(0, 8).toUpperCase(),
        startDate: booking.start_date,
        endDate: booking.end_date,
        items: [{ title: `${rental?.title ?? 'Equipment'}${(booking.quantity ?? 1) > 1 ? ` x${booking.quantity}` : ''}`, serial: rental?.serial_number }],
        deposit: Number(booking.deposit_amount ?? 0),
      }),
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    idChecked?: boolean;
    collectorIsRenter?: boolean;
    condition?: string;
    conditionPhotos?: string[];
    renterPhoto?: string | null;
    signature?: string;
    agreementVersion?: string;
    serials?: string[];
    accessories?: string[];
    location?: string;
    riskApproved?: boolean;
    riskNote?: string;
  } | null;

  if (!body?.idChecked) {
    return NextResponse.json({ error: 'Check the renter against their ID first.' }, { status: 400 });
  }
  // Only the renter collects (spec §7.11). Anyone else is turned away.
  if (body.collectorIsRenter !== true) {
    return NextResponse.json({ error: 'Gear is handed only to the renter named on the booking.' }, { status: 400 });
  }
  if (!body.condition || !CONDITIONS.includes(body.condition as (typeof CONDITIONS)[number])) {
    return NextResponse.json({ error: 'Choose the condition the gear leaves in.' }, { status: 400 });
  }
  const photos = (body.conditionPhotos ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://'));
  if (photos.length === 0) {
    return NextResponse.json({ error: 'Take at least one condition photo.' }, { status: 400 });
  }
  if (
    typeof body.signature !== 'string' ||
    !body.signature.startsWith('data:image/png;base64,') ||
    body.signature.length > MAX_SIGNATURE_CHARS
  ) {
    return NextResponse.json({ error: 'The renter needs to sign.' }, { status: 400 });
  }
  if (body.agreementVersion !== AGREEMENT_VERSION) {
    return NextResponse.json({ error: 'The agreement changed; reload the page.' }, { status: 409 });
  }
  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 200) : '';
  if (location.length < 3) {
    return NextResponse.json({ error: 'Record where the handover happened.' }, { status: 400 });
  }
  const clean = (xs: unknown): string[] =>
    Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 30) : [];
  const serials = clean(body.serials);
  const accessories = clean(body.accessories);

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('equipment_bookings')
    .select('id, user_id, status, smart_rentals(serial_number)')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const extra = await admin.from('equipment_bookings').select('requires_manual_approval').eq('id', id).maybeSingle();
  // Not knowing whether a risk approval is needed is not "not needed".
  if (extra.error && !isMissingPipeline(extra.error)) {
    return NextResponse.json({ error: 'Could not load this booking just now. Nothing was changed; try again.' }, { status: 503 });
  }
  const needsRiskApproval = (extra.data as { requires_manual_approval?: boolean } | null)?.requires_manual_approval === true;

  // Identity must be approved before gear leaves (spec §3.5).
  const { data: renter, error: renterErr } = await admin.from('profiles').select('verification_status, is_suspended').eq('id', booking.user_id).maybeSingle();
  if (renterErr) return NextResponse.json({ error: 'Could not check the renter just now. Do not hand over yet; try again.' }, { status: 503 });
  if ((renter as { verification_status?: string } | null)?.verification_status !== 'verified') {
    return NextResponse.json({ error: 'The renter has not passed identity verification. Do not hand over.' }, { status: 409 });
  }
  if ((renter as { is_suspended?: boolean } | null)?.is_suspended) {
    return NextResponse.json({ error: 'The renter account is suspended. Do not hand over.' }, { status: 409 });
  }
  if (needsRiskApproval && !(body.riskApproved === true && typeof body.riskNote === 'string' && body.riskNote.trim().length >= 5)) {
    return NextResponse.json({ error: 'This booking needs a manager to approve the risk, with a note, before handover.', code: 'RISK_APPROVAL_REQUIRED' }, { status: 409 });
  }

  // Serial numbers must match the registered serial (when there is one).
  const rental = (Array.isArray(booking.smart_rentals) ? booking.smart_rentals[0] : booking.smart_rentals) as { serial_number?: string | null } | null;
  const registered = rental?.serial_number?.trim();
  const norm = (x: string) => x.replace(/\s+/g, '').toUpperCase();
  if (registered && !serials.some((sn) => norm(sn) === norm(registered))) {
    return NextResponse.json({ error: 'Confirm the serial number on the gear matches the registered one.', code: 'SERIAL_MISMATCH' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const handover = {
    id_checked: true,
    collector_is_renter: true,
    renter_photo: typeof body.renterPhoto === 'string' && body.renterPhoto.startsWith('https://') ? body.renterPhoto : null,
    signature: body.signature,
    agreement_version: AGREEMENT_VERSION,
    serials,
    accessories,
    location,
    risk_approval: needsRiskApproval ? { by: auth.user.id, note: String(body.riskNote).trim().slice(0, 500) } : null,
    by: auth.user.id,
    at: now,
  };

  const moved = await transitionBookings(admin, {
    ids: [id],
    from: ['confirmed'],
    to: 'active',
    actor: 'staff',
    actorId: auth.user.id,
    reason: 'handover',
    patch: { condition_at_checkout: body.condition, checkout_photos: photos, handover },
    notices: buildNotices({ kind: 'handover_completed', userId: booking.user_id, bookingIds: [id], discriminator: id }),
  });

  if (moved.result === 'missing_pipeline') {
    // Migration 070 not applied: the earlier guarded update.
    const { data, error } = await admin
      .from('equipment_bookings')
      .update({ status: 'active', condition_at_checkout: body.condition, checkout_photos: photos, handover, updated_at: now })
      .eq('id', id)
      .eq('status', 'confirmed')
      .select('id');
    if (error) return NextResponse.json({ error: 'Could not record the handover.' }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'Only a confirmed (paid) booking can be handed over.' }, { status: 409 });
  } else if (moved.result === 'conflict') {
    return NextResponse.json({ error: 'Only a confirmed (paid) booking can be handed over.' }, { status: 409 });
  } else if (moved.result === 'already') {
    return NextResponse.json({ ok: true, already: true });
  }

  logEvent({ eventType: 'gear_handed_over', eventCategory: 'booking', userId: booking.user_id, metadata: { bookingId: id, by: auth.user.id } });
  await dispatchOutbox(10).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
