export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { requireAdmin } from '@/lib/auth';
import { reembedAllApproved } from '@/lib/roles/embed-server';

/** Admin: rebuild every approved profile's embedding (unchanged documents are skipped). POST. */
export async function POST(): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ counts: await reembedAllApproved() });
  } catch {
    console.error('[admin/roles/reembed] failed');
    return NextResponse.json({ error: 'Re-embedding failed.' }, { status: 500 });
  }
}
