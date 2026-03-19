export const dynamic = 'force-dynamic';

import { getAllCrewRequests } from '@/lib/supabase/queries/crew';
import CreatorRequestsManager from './CreatorRequestsManager';

export const metadata = {
  title: 'Creator Requests — Admin',
};

export default async function AdminCreatorRequestsPage() {
  const requests = await getAllCrewRequests();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-display font-medium uppercase text-white">
          Creator Requests
        </h1>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Manage creator booking requests. You are the middleman between clients and creators.
        </p>
      </div>

      <CreatorRequestsManager initialRequests={requests} />
    </div>
  );
}
