export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { STUDIO } from '@/lib/constants';
import { getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { buildPageMetadata, metaDescription } from '@/lib/seo/metadata';
import { RoleProfile } from '@/components/roles/RoleProfile';

interface Props {
  params: Promise<{ id: string }>;
}

const load = cache((id: string) => getPublicRoleProfile(id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await load(id);
  if (!p) return { title: 'Profile' };
  return buildPageMetadata({
    title: `${p.person.display_name}, ${p.role.name.toLowerCase()}`,
    description: metaDescription(p.personRole.headline ?? p.personRole.about, `${p.role.name} on ${STUDIO.shortName}.`),
    path: `/people/${id}`,
    // Not indexed during the roles_v1 trial (demo profiles live on dev).
    noIndex: true,
  });
}

/** A role profile (approved only; anything else is a 404). */
export default async function PersonRolePage({ params }: Props) {
  const { id } = await params;
  const profile = await load(id);
  if (!profile) notFound();
  return (
    <div className="pt-20">
      <RoleProfile profile={profile} />
    </div>
  );
}
