export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getCreatorGigs, expireStaleRequests } from '@/lib/supabase/queries/crew';
import { getCreatorBookings } from '@/lib/supabase/queries/service-bookings';
import { getBankingDetails } from '@/lib/supabase/queries/banking';
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

  const [gigs, serviceGigs, banking] = await Promise.all([
    getCreatorGigs(user.id),
    getCreatorBookings(user.id),
    getBankingDetails(user.id),
  ]);

  const hasBanking = !!banking;

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

      {!hasBanking && (
        <div className="bg-[#0A0A0B] border border-[#D4A843]/30 p-5 mb-8 flex items-start gap-4">
          <svg className="w-5 h-5 text-[#D4A843] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-mono font-bold text-white">Add banking details to get paid</p>
            <p className="text-xs font-mono text-neutral-500 mt-1">
              You need banking details on file before you can receive payouts from gigs.
            </p>
            <Link
              href="/dashboard/banking"
              className="inline-flex items-center gap-1 mt-3 text-[10px] font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:text-[#E5B954] transition-colors"
            >
              Add Banking Details &rarr;
            </Link>
          </div>
        </div>
      )}

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
