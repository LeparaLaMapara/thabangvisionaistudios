export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { STUDIO } from '@/lib/constants';
import { getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { buildPageMetadata, metaDescription } from '@/lib/seo/metadata';
import { RoleProfile } from '@/components/roles/RoleProfile';

interface Props {
  params: Promise<{ id: string }>;
}

const load = cache((id: string) => getPublicRoleProfile(id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!(await getFlag('roles_v1'))) return { title: 'Profile' };
  const { id } = await params;
  const p = await load(id);
  if (!p) return { title: 'Profile' };
  return buildPageMetadata({
    title: p.label,
    description: metaDescription(p.personRole.headline ?? p.personRole.about, `${p.role.name} on ${STUDIO.shortName}.`),
    path: `/people/${id}`,
    noIndex: true,
  });
}

/** A role profile, blind (approved only; anything else is a 404). */
export default async function PersonRolePage({ params }: Props) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { id } = await params;
  const profile = await load(id);
  if (!profile) notFound();
  return (
    <div className="pt-20">
      <RoleProfile profile={profile} />
    </div>
  );
}
