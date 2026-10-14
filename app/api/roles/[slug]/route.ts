export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getMyFace, getMyPersonRole, getRole } from '@/lib/supabase/queries/roles';
import { clampPerKm, clampPrice, finishTodo, inlineLegalAsks, sanitizeFacts, FACT_LIST_KEYS } from '@/lib/roles';
import { reembedQuietly } from '@/lib/roles/embed-server';

/**
 * The signed-in person's profile for one role (screen 3 and "Done").
 *
 *   GET                       their draft and its proof (or null)
 *   PUT  { headline?, about?, area?, price_cents?, per_km_cents?, facts?, comes_with?, available_days? }
 *                             save fields on their own draft
 *   POST { action: 'submit' } send for review, when finishTodo() is empty
 *
 * Writes run as the person (RLS + column grants): they can never approve
 * themselves. Reads of their own private columns use the service role after
 * the session check.
 */

type Ctx = { params: Promise<{ slug: string }> };

const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

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
  const { user } = await session();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const mine = await getMyPersonRole(user.id, slug);
    return NextResponse.json({ personRole: mine?.personRole ?? null, evidence: mine?.evidence ?? [] });
  } catch {
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, max] of [['headline', 80], ['about', 600], ['area', 80]] as const) {
    const v = cleanText(body[k], max);
    if (v !== undefined) patch[k] = v;
  }
  if (typeof body.price_cents === 'number') patch.price_cents = clampPrice(body.price_cents, role.suggested_price_cents);
  if (typeof body.per_km_cents === 'number') {
    const km = clampPerKm(body.per_km_cents, role.suggested_price_cents);
    if (km !== null) patch.per_km_cents = km;
  }
  if (body.facts !== undefined) patch.facts = sanitizeFacts(body.facts);
  if (body.comes_with !== undefined) {
    const label = cleanText((body.comes_with as { label?: unknown } | null)?.label, 120);
    const ids = Array.isArray((body.comes_with as { evidence_ids?: unknown } | null)?.evidence_ids)
      ? ((body.comes_with as { evidence_ids: unknown[] }).evidence_ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) as string[]).slice(0, 8)
      : [];
    patch.comes_with = label ? { label, evidence_ids: ids } : {};
  }
  if (Array.isArray(body.available_days)) patch.available_days = [...new Set(body.available_days.filter((d): d is string => typeof d === 'string' && DAYS.has(d)))];

  try {
    const existing = await getMyPersonRole(user.id, slug);
    if (!existing) return NextResponse.json({ error: 'Start with "Show us your work" first.' }, { status: 404 });
    if (existing.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is live. Contact us to change it.' }, { status: 409 });
    if (existing.personRole.status !== 'draft') patch.status = 'draft';
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('person_roles').update(patch).eq('id', existing.personRole.id);
      if (error) throw new Error(error.message);
    }
    if (patch.facts !== undefined) await reembedQuietly(existing.personRole.id);
    const fresh = await getMyPersonRole(user.id, slug);
    return NextResponse.json({ personRole: fresh?.personRole ?? null, evidence: fresh?.evidence ?? [] });
  } catch {
    console.error('[roles] PUT failed');
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
    const [mine, face] = await Promise.all([getMyPersonRole(user.id, slug), getMyFace(user.id)]);
    if (!mine) return NextResponse.json({ error: 'Start with "Show us your work" first.' }, { status: 404 });
    if (mine.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is already live.' }, { status: 409 });

    const facts = sanitizeFacts(mine.personRole.facts);
    const asks = inlineLegalAsks(role.legal_requirements, role.slug);
    const todo = finishTodo({
      hasFace: !!face,
      roleLive: role.status === 'live',
      proofFormat: role.proof_format,
      workCount: mine.evidence.filter((e) => (e.kind === 'photo' || e.kind === 'video') && e.step_key !== 'face').length,
      listenCount: mine.evidence.filter((e) => e.media_kind === 'audio').length,
      factsCount: FACT_LIST_KEYS.reduce((n, k) => n + facts[k].length, 0) + facts.credits.length,
      missingLegal: asks.filter((a) => !mine.evidence.some((e) => e.kind === 'document' && e.legal_code === a.code)).length,
      priceCents: mine.personRole.price_cents,
    });
    if (todo.length) return NextResponse.json({ error: 'A few things are left.', todo }, { status: 422 });

    const { error } = await supabase.from('person_roles').update({ status: 'submitted' }).eq('id', mine.personRole.id);
    if (error) throw new Error(error.message);
    const fresh = await getMyPersonRole(user.id, slug);
    return NextResponse.json({ personRole: fresh?.personRole ?? null });
  } catch {
    console.error('[roles] submit failed');
    return NextResponse.json({ error: 'Could not send it. Please try again.' }, { status: 500 });
  }
}
