export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { effectiveUnit, formatRolePrice, pricedByDays } from '@/lib/roles';
import { parseRequestPrefill, prefillQuery } from '@/lib/roles/request-prefill';
import { saToday } from '@/lib/dates/johannesburg';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { RequestForm } from '@/components/roles/RequestForm';
import { parsePlanLink } from '@/lib/core/projects/plan';

export const metadata = buildPageMetadata({ title: 'Request a booking', description: 'Ask to book.', path: '/people', noIndex: true });

/**
 * Ask to book a person: who (blind), where, when. Signed in; no payment yet.
 * A link from Ubunye can prefill the day(s), area and note (checked in
 * lib/roles/request-prefill.ts); the price always comes from the profile.
 */
function withPlanQuery(qs: string, plan: { planId: string | null; needItemId: string | null }): string {
  if (!plan.planId) return qs;
  const q = new URLSearchParams(qs.replace(/^\?/, ''));
  q.set('plan', plan.planId);
  if (plan.needItemId) q.set('need', plan.needItemId);
  return `?${q.toString()}`;
}

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const today = saToday();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Sign-in comes back here with the checked prefill, so nothing is typed twice.
  // A request sent from a plan carries it (checked ids only; the server checks the plan is theirs).
  const plan = (await getFlag('ubunye_projects')) ? parsePlanLink(query) : { planId: null, needItemId: null };
  if (!user) redirect(loginUrl(`/people/${id}/request${withPlanQuery(prefillQuery(parseRequestPrefill(query, today, { byDays: true })), plan)}`));
  const profile = await getPublicRoleProfile(id);
  if (!profile) notFound();
  const price = profile.personRole.price_cents ?? profile.role.suggested_price_cents.typical;
  const unit = effectiveUnit(profile.role.pricing_unit, profile.personRole.pricing_unit);
  const prefill = parseRequestPrefill(query, today, { byDays: pricedByDays(unit) });

  return (
    <div className="pt-28 pb-16 px-4">
      <div className="max-w-lg mx-auto">
        <Link href={`/people/${id}`} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-neutral-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </Link>
        <h1 className="text-3xl font-display font-medium text-white mb-1">Request a booking</h1>
        <p className="text-neutral-400 mb-6">
          {profile.label} · {formatRolePrice(unit, price, profile.personRole.per_km_cents)}
        </p>
        <RequestForm
          personRoleId={id}
          defaultArea={prefill.area ?? profile.personRole.area ?? ''}
          defaultDates={prefill.dates}
          defaultNote={prefill.note ?? ''}
          minDate={today}
          unit={unit}
          priceCents={price}
          planId={plan.planId}
          needItemId={plan.needItemId}
        />
      </div>
    </div>
  );
}
