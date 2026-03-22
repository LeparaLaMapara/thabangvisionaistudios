export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { STUDIO } from '@/lib/constants';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkRateLimit(`crew-pay:${user.id}`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  // Get the crew request
  const { data: request, error } = await supabase
    .from('crew_requests')
    .select('id, creator_id, client_email, client_name, project_type, status, total_amount, commission_amount')
    .eq('id', id)
    .single();

  if (error || !request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Only the client can pay
  if (user.email !== request.client_email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Must be in 'confirmed' status with a total_amount set (admin sets this)
  if (request.status !== 'confirmed') {
    return NextResponse.json({ error: 'Request must be confirmed before payment' }, { status: 400 });
  }

  if (!request.total_amount || request.total_amount <= 0) {
    return NextResponse.json({ error: 'Total amount not yet set. Please wait for admin to set the price.' }, { status: 400 });
  }

  if (!payments.isConfigured()) {
    return NextResponse.json({ error: 'Payment provider is not configured' }, { status: 503 });
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || STUDIO.meta.url;
    const result = await payments.createCheckout({
      paymentId: request.id,
      amount: request.total_amount,
      itemName: `Creator Booking: ${request.project_type}`,
      itemDescription: `Booking with creator via ${STUDIO.name}`,
      email: request.client_email,
      returnUrl: `${baseUrl}/dashboard/creator-requests?payment=success`,
      cancelUrl: `${baseUrl}/dashboard/creator-requests?payment=cancelled`,
      metadata: {
        customStr1: 'crew_request',
        customStr2: user.id,
        customStr3: request.creator_id,
      },
    });

    return NextResponse.json({ paymentUrl: result.paymentUrl });
  } catch (err) {
    console.error('[creator-requests/pay] Error:', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
