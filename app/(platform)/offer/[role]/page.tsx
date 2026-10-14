export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { STUDIO } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getRole } from '@/lib/supabase/queries/roles';
import { offerRolePath } from '@/lib/welcome';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { RoleMakerScreen } from '@/components/roles/RoleMakerScreen';

interface Props {
  params: Promise<{ role: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { role: slug } = await params;
  const role = (await getFlag('roles_v1')) ? await getRole(slug) : null;
  return buildPageMetadata({
    title: role ? `Offer: ${role.name.toLowerCase()}` : 'Offer',
    description: role ? `${role.description} Join ${STUDIO.shortName} free.` : `Join ${STUDIO.shortName}.`,
    path: offerRolePath(slug),
    noIndex: true,
  });
}

/** OFFER, step two: the profile maker for one role (roles_v1). */
export default async function OfferRolePage({ params }: Props) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role: slug } = await params;
  const role = await getRole(slug);
  if (!role) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(offerRolePath(role.slug)));
  return <RoleMakerScreen role={role} supabase={supabase} userId={user.id} />;
}
