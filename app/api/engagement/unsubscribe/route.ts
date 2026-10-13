export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import { setLifecycleOptOut } from '@/lib/engagement/preferences';
import { verifyUnsubscribe } from '@/lib/engagement/unsubscribe';

/**
 * Stops lifecycle emails for one person. Two callers:
 *   - mail clients' one-click button (RFC 8058): POST with the signed u and t
 *     in the query string and body "List-Unsubscribe=One-Click";
 *   - the button on /email-preferences: a form POST with u and t fields,
 *     answered with a redirect back to that page.
 * The HMAC (ENGAGEMENT_SIGNING_SECRET) is the only credential: no sign-in.
 * GET does nothing, so link scanners cannot unsubscribe anyone.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await checkRateLimit(`lifecycle-unsub:${clientIp(request.headers)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }

  const url = new URL(request.url);
  let u = url.searchParams.get('u');
  let t = url.searchParams.get('t');
  let fromPage = false;
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      if (form.get('from') === 'page') {
        fromPage = true;
        u = String(form.get('u') ?? '') || u;
        t = String(form.get('t') ?? '') || t;
      }
    } catch {
      /* one-click bodies are tiny; a bad body just falls back to the query */
    }
  }

  if (!verifyUnsubscribe(u, t)) {
    return fromPage
      ? NextResponse.redirect(new URL('/email-preferences?error=link', url.origin), 303)
      : NextResponse.json({ error: 'This link is not valid.' }, { status: 400 });
  }

  try {
    await setLifecycleOptOut(u!, true);
  } catch (err) {
    console.error('[engagement/unsubscribe] failed:', err instanceof Error ? err.message : err);
    return fromPage
      ? NextResponse.redirect(new URL('/email-preferences?error=save', url.origin), 303)
      : NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }

  return fromPage
    ? NextResponse.redirect(new URL('/email-preferences?done=1', url.origin), 303)
    : NextResponse.json({ ok: true });
}
