import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { logEvent } from '@/lib/data/events';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Staff work a booking request: move it along, give the client a quote, and
 * write to them. Any one or more of these in one call:
 *   status        only along the allowed steps (NEXT below)
 *   total_amount  the quote in rand; the commission follows the request's rate
 *   message       emailed to the client and kept in the notes
 *   admin_notes   replaces the private notes
 */

/** Where a request may go from each status. Finished requests stay finished. */
const NEXT: Record<string, string[]> = {
  pending: ['contacted', 'confirmed', 'declined', 'cancelled'],
  contacted: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
};

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const limited = await rateLimitAdmin(auth.user.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      status?: unknown;
      admin_notes?: unknown;
      total_amount?: unknown;
      message?: unknown;
    };
    const status = typeof body.status === 'string' ? body.status : undefined;
    const notes = typeof body.admin_notes === 'string' ? body.admin_notes.slice(0, 4000) : undefined;
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    const quote = body.total_amount === undefined || body.total_amount === null ? undefined : Number(body.total_amount);

    if (!status && notes === undefined && quote === undefined && !message) {
      return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
    }
    if (quote !== undefined && !(Number.isFinite(quote) && quote > 0 && quote < 10_000_000)) {
      return NextResponse.json({ error: 'Enter the quote in rand, more than zero.' }, { status: 400 });
    }

    const db = createAdminClient();
    const { data: request } = await db
      .from('crew_requests')
      .select('id, status, client_name, client_email, project_type, commission_rate, admin_notes')
      .eq('id', id)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

    if (status && status !== request.status && !(NEXT[request.status] ?? []).includes(status)) {
      return NextResponse.json(
        { error: `A request that is ${String(request.status).replace(/_/g, ' ')} cannot become ${status.replace(/_/g, ' ')}.`, code: 'BAD_STEP' },
        { status: 409 },
      );
    }

    // The message goes out first: if the email cannot be sent, nothing changes.
    let emailed = false;
    if (message) {
      if (!emailProvider.isConfigured()) {
        return NextResponse.json({ error: 'Email is not set up on this site, so the message was not sent. Nothing was changed.' }, { status: 503 });
      }
      try {
        await emailProvider.sendEmail({
          to: request.client_email,
          subject: `Your ${request.project_type} request — ${STUDIO.name}`,
          text: `Hi ${request.client_name},\n\n${message}\n\n${STUDIO.name}\n${STUDIO.email}`,
        });
        emailed = true;
      } catch (err) {
        console.error('[admin/creator-requests] email failed:', err);
        return NextResponse.json({ error: 'The email could not be sent. Nothing was changed; try again.' }, { status: 502 });
      }
    }

    const now = new Date();
    const update: Record<string, unknown> = { updated_at: now.toISOString() };
    if (status) update.status = status;
    if (quote !== undefined) {
      const rate = Number(request.commission_rate ?? STUDIO.creators.commissionRate);
      update.total_amount = Math.round(quote * 100) / 100;
      update.commission_amount = Math.round(quote * rate) / 100;
    }
    // A sent message is kept in the notes, so the next person sees what the client was told.
    const baseNotes = notes !== undefined ? notes : (request.admin_notes ?? '');
    const stamp = now.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
    const extra = [
      quote !== undefined ? `[${stamp}] Quote: ${formatRand(quote)}` : null,
      emailed ? `[${stamp}] Emailed the client: ${message}` : null,
    ].filter(Boolean);
    if (notes !== undefined || extra.length) {
      update.admin_notes = [baseNotes.trim(), ...extra].filter(Boolean).join('\n\n');
    }

    // Compare-and-set on the status read, so two people cannot both move it.
    const { data: written, error } = await db
      .from('crew_requests')
      .update(update)
      .eq('id', id)
      .eq('status', request.status)
      .select('id, status, admin_notes, total_amount, commission_amount, updated_at')
      .maybeSingle();
    if (error) {
      console.error('[admin/creator-requests] update failed:', error.message);
      return NextResponse.json({ error: emailed ? 'The email was sent, but the request could not be updated.' : 'Could not update the request.' }, { status: 500 });
    }
    if (!written) {
      return NextResponse.json({ error: 'Someone else changed this request. Reload it.' }, { status: 409 });
    }

    logEvent({
      eventType: 'crew_request_updated',
      eventCategory: 'admin',
      userId: auth.user.id,
      metadata: { requestId: id, from: request.status, to: status ?? request.status, quote: quote ?? null, emailed },
    });

    return NextResponse.json({ success: true, request: written, emailed });
  } catch {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
