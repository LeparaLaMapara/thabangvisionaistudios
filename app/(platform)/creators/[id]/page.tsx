import { notFound } from 'next/navigation';
import { getProfileById, getVerifiedProfiles } from '@/lib/supabase/queries/profiles';
import CreatorProfileClient from './CreatorProfileClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfileById(id);
  return {
    title: profile?.display_name ?? 'Creator Profile',
  };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CreatorProfilePage({ params }: Props) {
  const { id } = await params;
  const profile = await getProfileById(id);

  if (!profile) notFound();

  return <CreatorProfileClient profile={profile} />;
}

export async function generateStaticParams() {
  const profiles = await getVerifiedProfiles();
  return profiles.map((p) => ({ id: p.id }));
}
