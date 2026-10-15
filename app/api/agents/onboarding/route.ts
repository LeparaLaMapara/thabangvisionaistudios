import { NextRequest, NextResponse } from 'next/server';
import { aiBudgetResponse } from '@/lib/ai/budget-response';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { identifyGear } from '@/lib/agents/tools';
import { isOwnImageUrl } from '@/app/api/listings/_lib/images';

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
    if (!(await checkRateLimit(`agents:onboarding:${user.id}`, 50, 86_400_000))) {
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

    // The server fetches this image (identifyGear), so only photos uploaded to
    // our own storage account are accepted: an arbitrary URL would let anyone
    // make the server fetch internal or third-party addresses.
    if (typeof imageUrl !== 'string' || !isOwnImageUrl(imageUrl)) {
      return NextResponse.json({ error: 'Upload the photo first, then try again.' }, { status: 400 });
    }

    switch (action) {
      case 'identify-gear': {
        const result = await identifyGear(imageUrl, user.id);
        return NextResponse.json({ success: true, data: result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use 'identify-gear'.` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/agents/onboarding]', err);
    const budgetRes = aiBudgetResponse(err);
    if (budgetRes) return budgetRes;
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
