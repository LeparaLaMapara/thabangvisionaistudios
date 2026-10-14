export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EARN, STUDIO } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getMyFace, getRoles } from '@/lib/supabase/queries/roles';
import { OFFER_PATH } from '@/lib/welcome';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { OfferFlow } from '@/components/roles/OfferFlow';

export const metadata: Metadata = buildPageMetadata({
  title: EARN.label,
  description: `${EARN.copy} No portfolio needed. ${STUDIO.shortName}.`,
  path: OFFER_PATH,
  noIndex: true,
});

/**
 * Earn with ThabangVision (roles_v1): three screens. /join, /join/<role>,
 * /offer/<role> and /onboarding all land here (?role= preselects).
 */
export default async function OfferPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(role ? `${OFFER_PATH}?role=${encodeURIComponent(role)}` : OFFER_PATH));

  const [roles, face, profileRes] = await Promise.all([
    getRoles(),
    getMyFace(user.id),
    supabase.from('profiles').select('location, city').eq('id', user.id).maybeSingle(),
  ]);
  const preselect = roles.find((r) => r.slug === role && r.status === 'live')?.slug ?? null;

  return (
    <OfferFlow
      roles={roles}
      hasFace={!!face}
      faceUrl={face?.url ?? null}
      preselect={preselect}
      prefillArea={(profileRes.data?.location as string | null) ?? (profileRes.data?.city as string | null) ?? ''}
    />
  );
}
