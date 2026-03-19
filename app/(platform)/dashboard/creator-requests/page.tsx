export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getClientCrewRequests, expireStaleRequests } from '@/lib/supabase/queries/crew';
import CreatorRequestsList from './CreatorRequestsList';

export const metadata = {
  title: 'My Creator Requests',
};

export default async function CreatorRequestsPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const email = authUser?.email;

  if (!email) redirect('/login');

  // Lazy expiry: expire stale pending requests before loading
  await expireStaleRequests(supabase);

  const requests = await getClientCrewRequests(email);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">
          My Creator Requests
        </h2>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Track requests you have submitted for creators.
        </p>
      </div>

      <CreatorRequestsList requests={requests} />
    </div>
  );
}
