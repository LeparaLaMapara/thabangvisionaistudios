export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { draftMissingWelcomes } from '@/lib/greetings/process';

/** The welcome queue, newest first. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { data, error } = await createAdminClient()
    .from('welcome_messages')
    .select('user_id, email, first_name, signup_method, activity, subject, body, drafted_by, status, sent_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ welcomes: data ?? [] });
}

/** Drafts a welcome for everyone who has none yet. Safe to press twice. */
export async function POST() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const tally = await draftMissingWelcomes({ notifyOwner: false });
    return NextResponse.json({ tally });
  } catch (err) {
    console.error('[admin/welcomes] backfill failed:', err);
    return NextResponse.json({ error: 'Could not draft welcomes' }, { status: 500 });
  }
}
