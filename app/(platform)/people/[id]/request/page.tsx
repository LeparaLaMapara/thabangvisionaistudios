export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { effectiveUnit, formatRolePrice } from '@/lib/roles';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { RequestForm } from '@/components/roles/RequestForm';

export const metadata = buildPageMetadata({ title: 'Request a booking', description: 'Ask to book.', path: '/people', noIndex: true });

/** Ask to book a person: who (blind), where, when. Signed in; no payment yet. */
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(`/people/${id}/request`));
  const profile = await getPublicRoleProfile(id);
  if (!profile) notFound();
  const price = profile.personRole.price_cents ?? profile.role.suggested_price_cents.typical;
  const unit = effectiveUnit(profile.role.pricing_unit, profile.personRole.pricing_unit);

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
        <RequestForm personRoleId={id} defaultArea={profile.personRole.area ?? ''} unit={unit} priceCents={price} />
      </div>
    </div>
  );
}
