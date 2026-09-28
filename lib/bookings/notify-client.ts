import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

/** Tells the client about a step on their booking: in the dashboard and by email. Never throws. */
export async function notifyClient(params: {
  bookingId: string;
  type: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: b } = await admin
      .from('bookings')
      .select('client_id, client_email, reference')
      .eq('id', params.bookingId)
      .maybeSingle();
    if (!b) return;
    if (b.client_id) {
      await admin.from('notifications').insert({
        user_id: b.client_id,
        type: params.type,
        title: params.title,
        body: params.body,
        link: '/dashboard/bookings',
      });
    }
    if (b.client_email) {
      await emailProvider.sendEmail({
        to: b.client_email,
        subject: `${params.title} (${b.reference}) — ${STUDIO.name}`,
        text: `${params.body}\n\nSee your booking: ${STUDIO.meta.url}/dashboard/bookings\n\n${STUDIO.name}`,
      });
    }
  } catch (err) {
    console.error('[notifyClient]', err);
  }
}
