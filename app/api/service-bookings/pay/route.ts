export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref');
  if (!ref) {
    return NextResponse.json({ error: 'Missing ref parameter' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, reference, total, project_category, duration_hours, payment_status, paystack_access_code, client_id')
    .eq('reference', ref)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.client_id !== user.id) {
    return NextResponse.json({ error: 'Not your booking' }, { status: 403 });
  }

  if (booking.payment_status === 'paid') {
    return NextResponse.json({ error: 'Already paid', paid: true }, { status: 400 });
  }

  if (!booking.paystack_access_code) {
    return NextResponse.json({ error: 'No access code — use the payment link instead' }, { status: 400 });
  }

  return NextResponse.json({
    reference: booking.reference,
    accessCode: booking.paystack_access_code,
    total: booking.total,
    project_category: booking.project_category,
    duration_hours: booking.duration_hours,
    email: user.email,
  });
}
