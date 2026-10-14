export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { listReviewQueue, reviewCounts, EVIDENCE_COLUMNS, PERSON_ROLE_COLUMNS, getRole } from '@/lib/supabase/queries/roles';
import { bestDateOfBirth, confirmedJobCount, evidenceLevel, PERSON_ROLE_STATUSES, reviewLegal, type PersonRole, type RoleEvidence } from '@/lib/roles';

/**
 * The role review queue (App Store style: a person checks the proof against
 * the role's published guidelines before a profile is visible to clients).
 *
 *   GET   ?status=submitted (default) | changes_requested | approved | draft
 *   PATCH { id, action: 'approve' }
 *         Needs the ID check done, every legal document the role asks for
 *         present (the reviewer confirms them by approving) and the age rule
 *         met. Marks the documents and the in-app proof checked, sets the
 *         legal check and works out the evidence level.
 *   PATCH { id, action: 'changes', note }
 *         The note is required and must say how to get there.
 *   PATCH { id, action: 'verify_vouch', evidence_id }
 *         A reviewer called the person who vouched and they confirmed.
 */

const MIN_NOTE = 15;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const status = new URL(request.url).searchParams.get('status') ?? 'submitted';
  if (!(PERSON_ROLE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  }
  try {
    const [items, counts] = await Promise.all([listReviewQueue(status as PersonRole['status']), reviewCounts()]);
    return NextResponse.json({ items, counts });
  } catch (err) {
    console.error('[admin/roles] GET failed:', err);
    return NextResponse.json({ error: 'Could not load the queue.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const reviewer = auth.user.id;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: prRow } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('id', id).maybeSingle();
    if (!prRow) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const pr = prRow as unknown as PersonRole;
    const now = new Date();

    if (body.action === 'changes') {
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
      if (note.length < MIN_NOTE) {
        return NextResponse.json({ error: 'Say what to fix and how, so they can get there.' }, { status: 400 });
      }
      const { error } = await admin
        .from('person_roles')
        .update({ status: 'changes_requested', reviewer_note: note, reviewed_by: reviewer, reviewed_at: now.toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, status: 'changes_requested' });
    }

    const { data: evRows } = await admin.from('role_evidence').select(EVIDENCE_COLUMNS).eq('person_role_id', id);
    const evidence = (evRows ?? []) as unknown as RoleEvidence[];

    if (body.action === 'verify_vouch') {
      const evidenceId = typeof body.evidence_id === 'string' ? body.evidence_id : '';
      const item = evidence.find((e) => e.id === evidenceId && e.kind === 'vouch');
      if (!item) return NextResponse.json({ error: 'Vouch not found.' }, { status: 404 });
      const { error } = await admin.from('role_evidence').update({ verified_by: reviewer, verified_at: now.toISOString() }).eq('id', item.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (body.action !== 'approve') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    if (pr.status !== 'submitted') return NextResponse.json({ error: 'Only a submitted profile can be approved.' }, { status: 409 });

    const role = await getRole(pr.role_slug);
    if (!role) return NextResponse.json({ error: 'Unknown role.' }, { status: 409 });
    const { data: prof } = await admin.from('profiles').select('verification_status, verification_metadata').eq('id', pr.user_id).maybeSingle();
    const identityVerified = prof?.verification_status === 'verified';
    if (!identityVerified) {
      return NextResponse.json({ error: 'Their ID check is not done yet. Ask them to finish it, then approve.' }, { status: 409 });
    }
    const meta = (prof?.verification_metadata ?? null) as { id_document?: { date_of_birth?: string | null } } | null;
    const dob = bestDateOfBirth(meta?.id_document?.date_of_birth ?? null, pr.answers?.date_of_birth);
    // Approving confirms the documents in hand: treat them as checked here.
    const legal = reviewLegal(role, pr.answers, evidence.map((e) => (e.kind === 'document' ? { ...e, verified_at: now.toISOString() } : e)), dob, now);
    if (legal.age === 'too_young' || legal.age === 'unknown') {
      return NextResponse.json({ error: `Age not confirmed: they must be ${role.min_age} or older, and the date must match their ID.` }, { status: 409 });
    }
    if (legal.missing.length) {
      return NextResponse.json({ error: `Missing: ${legal.missing.map((r) => r.label).join(', ')}.` }, { status: 409 });
    }

    // Mark what the reviewer looked at as checked.
    const checkIds = evidence
      .filter((e) => !e.verified_at && (e.kind === 'document' || ((e.kind === 'photo' || e.kind === 'video') && e.source === 'captured_in_app')))
      .map((e) => e.id);
    if (checkIds.length) {
      const { error } = await admin.from('role_evidence').update({ verified_by: reviewer, verified_at: now.toISOString() }).in('id', checkIds);
      if (error) throw new Error(error.message);
    }

    const facts = evidence.map((e) => ({ kind: e.kind, source: e.source, verified: !!e.verified_at || checkIds.includes(e.id) }));
    const { data: reviews } = await admin.from('reviews').select('rating').eq('reviewee_id', pr.user_id).eq('is_published', true);
    const ratings = (reviews ?? []).map((r) => Number(r.rating)).filter((n) => Number.isFinite(n));
    const { count: disputes } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', pr.user_id)
      .not('disputed_at', 'is', null);
    const level = evidenceLevel({
      identityVerified,
      profileApproved: true,
      evidence: facts,
      confirmedJobs: confirmedJobCount(facts),
      reviewCount: ratings.length,
      averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
      disputes: disputes ?? 0,
    }).level;

    const { error } = await admin
      .from('person_roles')
      .update({
        status: 'approved',
        evidence_level: level,
        reviewer_note: null,
        reviewed_by: reviewer,
        reviewed_at: now.toISOString(),
        legal_verified_at: role.legal_requirements.some((r) => r.required) ? now.toISOString() : null,
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, status: 'approved', level });
  } catch (err) {
    console.error('[admin/roles] PATCH failed:', err);
    return NextResponse.json({ error: 'Could not save the decision.' }, { status: 500 });
  }
}
