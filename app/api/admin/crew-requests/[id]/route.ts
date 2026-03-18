import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateCrewRequestStatus } from '@/lib/supabase/queries/crew';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const admin = await auth.requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = await req.json();
    const { status, admin_notes, total_amount, commission_amount } = body;

    if (!status) {
      return NextResponse.json({ error: 'Status is required.' }, { status: 400 });
    }

    const validStatuses = ['pending', 'contacted', 'confirmed', 'declined', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    const result = await updateCrewRequestStatus(
      id,
      status,
      admin_notes,
      total_amount,
      commission_amount,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
