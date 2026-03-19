export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCreatorGigs, expireStaleRequests } from '@/lib/supabase/queries/crew';
import { getCreatorBookings } from '@/lib/supabase/queries/service-bookings';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import GigsList from './GigsList';
import ServiceGigsList from './ServiceGigsList';

export const metadata = {
  title: 'My Gigs',
};

export default async function GigsPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  // Lazy expiry: expire stale pending requests before loading gigs
  const supabase = await createClient();
  await expireStaleRequests(supabase);

  const [gigs, serviceGigs] = await Promise.all([
    getCreatorGigs(user.id),
    getCreatorBookings(user.id),
  ]);

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

      {/* Service bookings (new system — paid upfront) */}
      {serviceGigs.length > 0 && (
        <div className="mb-10">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
            Service Bookings
          </h3>
          <ServiceGigsList gigs={serviceGigs} />
        </div>
      )}

      {/* Legacy crew requests */}
      {gigs.length > 0 && (
        <div>
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
            Creator Requests
          </h3>
          <GigsList gigs={gigs} />
        </div>
      )}

      {gigs.length === 0 && serviceGigs.length === 0 && (
        <div className="py-12 text-center text-neutral-500">
          <p>No gigs yet.</p>
          <p className="mt-1 text-sm">When clients book you, their gigs will appear here.</p>
        </div>
      )}
    </div>
  );
}
