export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EARN, STUDIO } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getIdentityFacts, getMyFace, getMyPersonRoles, getRoles } from '@/lib/supabase/queries/roles';
import { OFFER_PATH } from '@/lib/welcome';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { OfferFlow } from '@/components/roles/OfferFlow';
import { OfferStatus } from '@/components/roles/OfferStatus';
import { effectiveUnit, identityState, offerStatusView, profileToShow } from '@/lib/roles';

export const metadata: Metadata = buildPageMetadata({
  title: EARN.label,
  description: `${EARN.copy} No portfolio needed. ${STUDIO.shortName}.`,
  path: OFFER_PATH,
  noIndex: true,
});

/**
 * Earn with ThabangVision (roles_v1): three screens. /join, /join/<role>,
 * /offer/<role> and /onboarding all land here (?role= preselects).
 *
 * Someone who already sent a profile sees where it is (with our team, live,
 * or sent back with the note) instead of an empty form, so signing in again
 * never puts them back into the form. ?edit=1 opens the form (to make a
 * change); ?new=1 offers something else.
 */
export default async function OfferPage({ searchParams }: { searchParams: Promise<{ role?: string; edit?: string; new?: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role, edit, new: fresh } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(role ? `${OFFER_PATH}?role=${encodeURIComponent(role)}` : OFFER_PATH));

  const [roles, face, profileRes, mine, identity] = await Promise.all([
    getRoles(),
    getMyFace(user.id),
    supabase.from('profiles').select('location, city').eq('id', user.id).maybeSingle(),
    getMyPersonRoles(user.id),
    getIdentityFacts(user.id),
  ]);
  const preselect = roles.find((r) => r.slug === role && r.status === 'live')?.slug ?? null;
  const idState = identityState(identity.verificationStatus);

  if (edit !== '1' && fresh !== '1') {
    const shown = profileToShow(mine, preselect);
    const shownRole = shown ? roles.find((r) => r.slug === shown.role_slug) : undefined;
    const view = shown && shownRole
      ? offerStatusView({ status: shown.status, reviewerNote: shown.reviewer_note ?? null, personRoleId: shown.id, roleName: shownRole.name, identity: idState })
      : null;
    if (view && shown && shownRole) {
      const cents = shown.price_cents ?? shownRole.suggested_price_cents.typical;
      return (
        <OfferStatus
          view={view}
          price={{ unit: effectiveUnit(shownRole.pricing_unit, shown.pricing_unit), cents }}
          editHref={`${OFFER_PATH}?role=${encodeURIComponent(shownRole.slug)}&edit=1`}
          newHref={`${OFFER_PATH}?new=1`}
        />
      );
    }
  }

  return (
    <OfferFlow
      roles={roles}
      hasFace={!!face}
      faceUrl={face?.url ?? null}
      preselect={preselect}
      prefillArea={(profileRes.data?.location as string | null) ?? (profileRes.data?.city as string | null) ?? ''}
      userId={user.id}
      identity={idState}
    />
  );
}
