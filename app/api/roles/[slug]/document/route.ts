export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { rolesOffResponse } from '@/lib/roles/flag';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getMyPersonRole, getRole, ROLE_DOCUMENT_BUCKET } from '@/lib/supabase/queries/roles';

/**
 * A one-time upload link for one legal document (licence, disc, ...).
 * POST { legal_code } -> { bucket, path, token }
 *
 * The photo goes from the phone straight to the private `role-documents`
 * bucket (Vercel refuses bodies over 4.5 MB). The server picks the path:
 * <user id>/<person_role id>/<code>-<random>.jpg. The page then records it
 * with POST /api/roles/[slug]/evidence { kind: 'document' }.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-document:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many uploads. Wait a moment.' }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* handled below */
  }

  try {
    const role = await getRole(slug);
    const code = typeof body.legal_code === 'string' ? body.legal_code : '';
    if (!role || !role.legal_requirements.some((r) => r.code === code && !r.code.startsWith('age_'))) {
      return NextResponse.json({ error: 'Unknown document.' }, { status: 400 });
    }
    const mine = await getMyPersonRole(supabase, user.id, slug);
    if (!mine) return NextResponse.json({ error: 'Start your profile first.' }, { status: 404 });
    if (mine.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is live already.' }, { status: 409 });

    const path = `${user.id}/${mine.personRole.id}/${code}-${crypto.randomUUID()}.jpg`;
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) {
      console.error('[roles/document] signed upload URL failed:', error?.message);
      return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ bucket: ROLE_DOCUMENT_BUCKET, path, token: data.token });
  } catch (err) {
    console.error('[roles/document] unexpected:', err);
    return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
  }
}
