import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { identifyGear, extractIdFields } from '@/lib/agents/tools';

// ─── POST /api/agents/onboarding ────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { user } = auth;

    const suspension = await checkNotSuspended(user.id);
    if (suspension.suspended) {
      return NextResponse.json(
        { error: `Account suspended: ${suspension.reason ?? 'Contact support.'}` },
        { status: 403 },
      );
    }

    // Rate limit: 50 requests per day per user
    if (!checkRateLimit(`agents:onboarding:${user.id}`, 50, 86_400_000)) {
      return NextResponse.json(
        { error: 'Daily limit reached. Try again tomorrow.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { action, imageUrl } = body as { action: string; imageUrl: string };

    if (!action || !imageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: action, imageUrl' },
        { status: 400 },
      );
    }

    // Basic URL validation
    try {
      const parsed = new URL(imageUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'Invalid image URL protocol.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid image URL.' }, { status: 400 });
    }

    switch (action) {
      case 'capture-id': {
        const result = await extractIdFields(imageUrl);
        return NextResponse.json({ success: true, data: result });
      }

      case 'identify-gear': {
        const result = await identifyGear(imageUrl);
        return NextResponse.json({ success: true, data: result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use 'capture-id' or 'identify-gear'.` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/agents/onboarding]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
