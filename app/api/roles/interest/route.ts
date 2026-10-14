export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { ROLES_POLICY } from '@/lib/constants';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * "Coming soon, leave your number." POST { role_slug, phone, name? }
 *
 * Anyone may leave a number (no sign-in: the person with the least should not
 * need an account to say "tell me when"). Written with the service role
 * because anon holds no write grant on role_interest (rls-coverage check 6);
 * rate limited per IP.
 */

const PHONE = /^\+?[0-9 ]{9,16}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { max, windowMs } = ROLES_POLICY.interestRateLimit;
  if (!(await checkRateLimit(`role-interest:${ip}`, max, windowMs))) {
    return NextResponse.json({ error: 'Too many tries. Please wait a while and try again.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Send your number.' }, { status: 400 });
  }

  const roleSlug = typeof body.role_slug === 'string' ? body.role_slug : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : null;
  if (!/^[a-z0-9-]{2,40}$/.test(roleSlug)) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 400 });
  if (!PHONE.test(phone)) return NextResponse.json({ error: 'Please check your number. Example: 072 123 4567' }, { status: 400 });
  if (name && /[<>]/.test(name)) return NextResponse.json({ error: 'Please use letters for your name.' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: role } = await admin.from('roles').select('slug, status').eq('slug', roleSlug).maybeSingle();
    if (!role) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await admin.from('role_interest').insert({ role_slug: roleSlug, phone, name, user_id: user?.id ?? null });
    if (error) {
      console.error('[roles/interest] insert failed:', error.message);
      return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[roles/interest] unexpected:', err);
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
  }
}
