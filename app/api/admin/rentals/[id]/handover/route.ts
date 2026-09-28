export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { AGREEMENT_VERSION, handoverAgreement } from '@/lib/rental/agreement';
import { logEvent } from '@/lib/data/events';

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
    condition?: string;
    conditionPhotos?: string[];
    renterPhoto?: string | null;
    signature?: string;
    agreementVersion?: string;
  } | null;

  if (!body?.idChecked) {
    return NextResponse.json({ error: 'Check the renter against their ID first.' }, { status: 400 });
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

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('equipment_bookings')
    .update({
      status: 'active',
      condition_at_checkout: body.condition,
      checkout_photos: photos,
      handover: {
        id_checked: true,
        renter_photo: typeof body.renterPhoto === 'string' && body.renterPhoto.startsWith('https://') ? body.renterPhoto : null,
        signature: body.signature,
        agreement_version: AGREEMENT_VERSION,
        by: auth.user.id,
        at: now,
      },
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'confirmed')
    .select('id, user_id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: 'Only a confirmed (paid) booking can be handed over.' }, { status: 409 });
  }

  logEvent({ eventType: 'gear_handed_over', eventCategory: 'booking', userId: data[0].user_id, metadata: { bookingId: id, by: auth.user.id } });
  return NextResponse.json({ ok: true });
}
