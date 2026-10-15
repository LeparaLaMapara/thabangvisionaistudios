export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getClientCrewRequests, expireStaleRequests } from '@/lib/supabase/queries/crew';
import CreatorRequestsList from './CreatorRequestsList';
import { DashboardSubTabs, ACTIVITY_TABS } from '@/components/dashboard/DashboardSubTabs';
import { getFlag } from '@/lib/features';
import { listClientRequests } from '@/lib/supabase/queries/role-requests';
import { PeopleRequestsList } from '@/components/dashboard/PeopleRequestsList';

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

  // People (roles_v1): the requests sent from /people, newest first, each
  // linking back to its page. Older creator requests stay below, if any.
  if (await getFlag('roles_v1')) {
    const people = await listClientRequests(user.id);
    return (
      <div>
        <DashboardSubTabs tabs={ACTIVITY_TABS} />
        <div className="mb-8">
          <h2 className="text-lg font-display font-medium uppercase text-white">My Hires</h2>
          <p className="text-xs font-mono text-neutral-400 mt-2">People you asked to book, and where each request is.</p>
        </div>
        <PeopleRequestsList requests={people} />
        {requests.length > 0 && (
          <div className="mt-12">
            <h3 className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-4">Older creator requests</h3>
            <CreatorRequestsList requests={requests} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <DashboardSubTabs tabs={ACTIVITY_TABS} />
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">
          My Hires
        </h2>
        <p className="text-xs font-mono text-neutral-400 mt-2">
          Track requests you have submitted for creators.
        </p>
      </div>

      <CreatorRequestsList requests={requests} />
    </div>
  );
}
