export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { requireAdmin } from '@/lib/auth';
import { cleanMatchText } from '@/lib/roles';
import { matchPeople } from '@/lib/roles/embed-server';

/**
 * Admin/dev only: who fits a request ("make-up artist for a wedding in
 * Soweto")? Similarity on the competence-only profile embeddings, ranked
 * with the record and the fair "new" slots. Returns blind labels only.
 *   GET ?q=...&role=<slug>
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const params = new URL(req.url).searchParams;
  const q = cleanMatchText(params.get('q') ?? '');
  const role = params.get('role');
  if (!q) return NextResponse.json({ error: 'Type a request.' }, { status: 400 });
  try {
    const matches = await matchPeople(q, { role: role && /^[a-z0-9-]{2,40}$/.test(role) ? role : null });
    return NextResponse.json({
      matches: matches.map((m) => ({
        id: m.id,
        label: m.label,
        role: m.roleSlug,
        similarity: Number(m.similarity.toFixed(3)),
        reliability: Number(m.reliability.toFixed(3)),
        score: Number(m.score.toFixed(3)),
        isNew: m.isNew,
        jobs: m.record.jobs,
      })),
    });
  } catch {
    console.error('[admin/roles/match] failed');
    return NextResponse.json({ error: 'Matching failed.' }, { status: 500 });
  }
}
