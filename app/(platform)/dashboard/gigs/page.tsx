export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCreatorGigs } from '@/lib/supabase/queries/crew';
import { STUDIO } from '@/lib/constants';
import GigsList from './GigsList';

export const metadata = {
  title: 'My Gigs',
};

export default async function GigsPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const gigs = await getCreatorGigs(user.id);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">
          Your Gigs
        </h2>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Gig requests are managed by {STUDIO.shortName}. We handle all client communication.
        </p>
      </div>

      <GigsList gigs={gigs} />
    </div>
  );
}
