export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { sendWelcome } from '@/lib/greetings/process';

/**
 * Act on one queued welcome:
 *   { action: 'save', subject, body }  edit the draft
 *   { action: 'send' }                 send it (once)
 *   { action: 'discard' }              never send it
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { userId } = await params;

  const body = (await request.json().catch(() => ({}))) as { action?: string; subject?: string; body?: string };
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (body.action === 'save') {
    const subject = (body.subject ?? '').trim();
    const text = (body.body ?? '').trim();
    if (subject.length < 3 || text.length < 20) {
      return NextResponse.json({ error: 'Subject and message are required.' }, { status: 400 });
    }
    const { data, error } = await admin
      .from('welcome_messages')
      .update({ subject, body: text, drafted_by: 'owner', updated_at: now })
      .eq('user_id', userId)
      .eq('status', 'draft')
      .select('user_id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'Only a draft can be edited.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'send') {
    const result = await sendWelcome(userId, auth.user.id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (body.action === 'discard') {
    const { error } = await admin
      .from('welcome_messages')
      .update({ status: 'discarded', updated_at: now })
      .eq('user_id', userId)
      .eq('status', 'draft');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
