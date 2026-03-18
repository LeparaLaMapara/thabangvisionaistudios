export const dynamic = 'force-dynamic';

import { getAllCrewRequests } from '@/lib/supabase/queries/crew';
import CrewRequestsManager from './CrewRequestsManager';

export const metadata = {
  title: 'Crew Requests — Admin',
};

export default async function AdminCrewRequestsPage() {
  const requests = await getAllCrewRequests();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-display font-medium uppercase text-white">
          Crew Requests
        </h1>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Manage crew booking requests. You are the middleman between clients and creators.
        </p>
      </div>

      <CrewRequestsManager initialRequests={requests} />
    </div>
  );
}
