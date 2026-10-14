export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getMyPreview } from '@/lib/supabase/queries/roles';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { RoleProfile } from '@/components/roles/RoleProfile';

export const metadata = buildPageMetadata({ title: "Here's how clients will see you", description: 'Your profile preview.', path: '/offer/preview', noIndex: true });

/** "Here's how clients will see you": the person's own draft, blind, as clients will see it. */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(`/offer/preview?role=${role ?? ''}`));
  const preview = role && /^[a-z0-9-]{2,40}$/.test(role) ? await getMyPreview(user.id, role) : null;
  if (!preview) notFound();
  return (
    <div className="pt-20">
      <p className="max-w-3xl mx-auto px-4 pt-6 text-xs font-mono uppercase tracking-widest text-neutral-400">Here&apos;s how clients will see you</p>
      <RoleProfile profile={preview} preview />
    </div>
  );
}
