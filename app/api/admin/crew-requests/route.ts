import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAllCrewRequests } from '@/lib/supabase/queries/crew';

export async function GET(): Promise<NextResponse> {
  try {
    const admin = await auth.requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requests = await getAllCrewRequests();
    return NextResponse.json({ requests });
  } catch {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
