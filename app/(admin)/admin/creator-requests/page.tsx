export const dynamic = 'force-dynamic';

import { getAllCrewRequests } from '@/lib/supabase/queries/crew';
import CreatorRequestsManager from './CreatorRequestsManager';

export const metadata = {
  title: 'Booking requests',
};

export default async function AdminCreatorRequestsPage() {
  const requests = await getAllCrewRequests();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      <div className="mb-8">
        <p className="text-sm text-neutral-400">Bookings</p>
        <h1 className="mt-1 font-display text-3xl text-white">Booking requests</h1>
        <p className="mt-2 text-neutral-300">
          People asking to book a creator. Write to them, send a quote, and confirm once the creator is free.
        </p>
      </div>

      <CreatorRequestsManager initialRequests={requests} />
    </div>
  );
}
