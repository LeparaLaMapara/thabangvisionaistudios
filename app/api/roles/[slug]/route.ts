export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVIDENCE_COLUMNS, getIdentityFacts, getMyPersonRole, getRole, PERSON_ROLE_COLUMNS } from '@/lib/supabase/queries/roles';
import { bestDateOfBirth, canSubmit, clampPerKm, clampPrice, CREATOR_FLOW_ROLE, legalQuestions, portfolioEvidenceRows } from '@/lib/roles';

/**
 * The signed-in person's profile for one role.
 *
 *   GET                       their draft and its proof (or null)
 *   PUT  { headline?, about?, area?, price_cents?, per_km_cents?, answers? }
 *                             create the draft if needed, save fields
 *   POST { action: 'submit' } send for review, when canSubmit says so
 *
 * Every write runs as the person (RLS + column grants, migration 090): they
 * can never approve themselves or set their own level.
 */

type Ctx = { params: Promise<{ slug: string }> };

const ANSWER_KEYS = new Set(['date_of_birth', 'seats', 'boot']);

function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  if (/[<>]/.test(t)) return undefined;
  return t || null;
}

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const mine = await getMyPersonRole(supabase, user.id, slug);
    return NextResponse.json({ personRole: mine?.personRole ?? null, evidence: mine?.evidence ?? [] });
  } catch (err) {
    console.error('[roles] GET failed:', err);
    return NextResponse.json({ error: 'Could not load your profile.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-save:${user.id}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many saves. Wait a moment.' }, { status: 429 });
  }

  const role = await getRole(slug);
  if (!role) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 404 });
  if (role.status !== 'live') return NextResponse.json({ error: 'This kind of work opens soon.' }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  const headline = cleanText(body.headline, 80);
  const about = cleanText(body.about, 600);
  const area = cleanText(body.area, 80);
  if (headline !== undefined) patch.headline = headline;
  if (about !== undefined) patch.about = about;
  if (area !== undefined) patch.area = area;
  if (typeof body.price_cents === 'number') patch.price_cents = clampPrice(body.price_cents, role.suggested_price_cents);
  if (typeof body.per_km_cents === 'number') {
    const km = clampPerKm(body.per_km_cents, role.suggested_price_cents);
    if (km !== null) patch.per_km_cents = km;
  }

  try {
    const existing = await getMyPersonRole(supabase, user.id, slug);
    if (existing?.personRole.status === 'approved') {
      return NextResponse.json({ error: 'Your profile is live. Contact us to change it.' }, { status: 409 });
    }

    if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
      const allowed = new Set([...ANSWER_KEYS, ...legalQuestions(role.legal_requirements).map((q) => q.key)]);
      const answers: Record<string, unknown> = { ...(existing?.personRole.answers ?? {}) };
      for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
        if (!allowed.has(k)) continue;
        if (typeof v === 'boolean' || v === null) answers[k] = v;
        else if (typeof v === 'string' && v.length <= 40 && !/[<>]/.test(v)) answers[k] = v.trim();
      }
      patch.answers = answers;
    }

    // Saving after "changes requested" or while submitted goes back to draft
    // until the person sends it again.
    if (existing && existing.personRole.status !== 'draft') patch.status = 'draft';

    if (!existing) {
      if (patch.price_cents === undefined) patch.price_cents = role.suggested_price_cents.typical;
      if (patch.per_km_cents === undefined && role.suggested_price_cents.per_km !== undefined) patch.per_km_cents = role.suggested_price_cents.per_km;
      const { status: _ignored, ...insertable } = patch;
      void _ignored;
      const { data, error } = await supabase
        .from('person_roles')
        .insert({ user_id: user.id, role_slug: slug, ...insertable })
        .select(PERSON_ROLE_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      // Someone who started the old creator onboarding keeps their photos:
      // they become evidence (marked uploaded, not taken in the app).
      let evidence: unknown[] = [];
      if (slug === CREATOR_FLOW_ROLE) {
        const { data: prof } = await supabase.from('profiles').select('portfolio_projects').eq('id', user.id).maybeSingle();
        const rows = portfolioEvidenceRows((data as { id: string }).id, prof?.portfolio_projects);
        if (rows.length) {
          const { data: ev, error: evError } = await supabase.from('role_evidence').insert(rows).select(EVIDENCE_COLUMNS);
          if (evError) console.error('[roles] portfolio import failed:', evError.message);
          evidence = ev ?? [];
        }
      }
      return NextResponse.json({ personRole: data, evidence }, { status: 201 });
    }

    if (Object.keys(patch).length === 0) return NextResponse.json(existing);
    const { data, error } = await supabase
      .from('person_roles')
      .update(patch)
      .eq('id', existing.personRole.id)
      .select(PERSON_ROLE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ personRole: data, evidence: existing.evidence });
  } catch (err) {
    console.error('[roles] PUT failed:', err);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  if (body.action !== 'submit') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  try {
    const role = await getRole(slug);
    if (!role) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 404 });
    const mine = await getMyPersonRole(supabase, user.id, slug);
    if (!mine) return NextResponse.json({ error: 'Start your profile first.' }, { status: 404 });
    if (mine.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is already live.' }, { status: 409 });

    const identity = await getIdentityFacts(user.id);
    const check = canSubmit({
      role,
      answers: mine.personRole.answers,
      evidence: mine.evidence,
      priceCents: mine.personRole.price_cents,
      dateOfBirth: bestDateOfBirth(identity.dateOfBirthFromId, mine.personRole.answers?.date_of_birth),
      now: new Date(),
    });
    if (!check.ok) return NextResponse.json({ error: 'A few things are left.', todo: check.todo }, { status: 422 });

    const { data, error } = await supabase
      .from('person_roles')
      .update({ status: 'submitted' })
      .eq('id', mine.personRole.id)
      .select(PERSON_ROLE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ personRole: data, evidence: mine.evidence, identityVerified: identity.identityVerified });
  } catch (err) {
    console.error('[roles] submit failed:', err);
    return NextResponse.json({ error: 'Could not send it. Please try again.' }, { status: 500 });
  }
}
