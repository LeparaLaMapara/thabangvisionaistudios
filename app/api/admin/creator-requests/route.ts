import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllCrewRequests } from '@/lib/supabase/queries/crew';

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const requests = await getAllCrewRequests();
    return NextResponse.json({ requests });
  } catch {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
