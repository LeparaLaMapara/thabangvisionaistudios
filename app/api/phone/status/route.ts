export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { phoneChecksAvailable } from '@/lib/sms/availability';

/** Whether phone confirmation is switched on, so the profile page can hide the step until it is. */
export async function GET() {
  return NextResponse.json({ available: phoneChecksAvailable() });
}
