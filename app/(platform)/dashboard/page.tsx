export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { auth } from '@/lib/auth';
import { getProfileById } from '@/lib/supabase/queries/profiles';
import { Calendar, Package, ShoppingBag, ArrowRight, Users, Search, ShieldCheck, Clock, Briefcase, FileText, Settings } from 'lucide-react';

export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const user = await auth.getUser();
  const supabase = await createClient();

  const profile = user ? await getProfileById(user.id) : null;

  // Fetch verification status
  let verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected' = 'unverified';
  if (user) {
    const { data: vData } = await supabase
      .from('profiles')
      .select('verification_status')
      .eq('id', user.id)
      .single();
    if (vData?.verification_status) {
      verificationStatus = vData.verification_status;
    }
  }

  const isVerified = verificationStatus === 'verified';

  // Fetch auth user for email (needed for crew_requests client_email query)
  const { data: { user: authUser } } = await supabase.auth.getUser();

  // Fetch real counts from Supabase
  const [bookingsResult, listingsResult, ordersResult, gigsResult, requestsResult] = await Promise.all([
    user
      ? supabase
          .from('equipment_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
      : { count: 0 },
    user && isVerified
      ? supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('deleted_at', null)
      : { count: 0 },
    user && isVerified
      ? supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      : { count: 0 },
    user && isVerified
      ? supabase
          .from('crew_requests')
          .select('id', { count: 'exact', head: true })
          .eq('creator_id', user.id)
      : { count: 0 },
    authUser?.email
      ? supabase
          .from('crew_requests')
          .select('id', { count: 'exact', head: true })
          .eq('client_email', authUser.email)
      : { count: 0 },
  ]);

  const bookingsCount = ('count' in bookingsResult ? bookingsResult.count : 0) ?? 0;
  const listingsCount = ('count' in listingsResult ? listingsResult.count : 0) ?? 0;
  const ordersCount = ('count' in ordersResult ? ordersResult.count : 0) ?? 0;
  const gigsCount = ('count' in gigsResult ? gigsResult.count : 0) ?? 0;
  const requestsCount = ('count' in requestsResult ? requestsResult.count : 0) ?? 0;

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Creator';
  const hasRequiredProfile = profile && (profile.display_name && profile.phone);

  return (
    <div>
      {/* Welcome hero */}
      <div className="mb-10">
        <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
          Dashboard
        </span>
        <h1 className="text-3xl md:text-4xl font-display font-medium uppercase text-black dark:text-white tracking-tight">
          Welcome back, <span className="text-neutral-400 dark:text-neutral-500">{displayName}</span>
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 font-mono mt-3">
          {isVerified
            ? 'You are a verified creator. List gear, book equipment, and manage your orders.'
            : 'Book equipment, hire creators, and explore the platform. Get verified to list your own gear and services.'}
        </p>
      </div>

      {/* Get Verified CTA (unverified users only) — first thing they see */}
      {!isVerified && verificationStatus !== 'pending' && (
        <div className="bg-[#0A0A0B] border border-[#D4A843]/30 p-8 mb-10">
          <div className="flex items-start gap-5">
            <ShieldCheck className="w-10 h-10 text-[#D4A843] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-display font-medium uppercase text-white mb-1">
                Get Verified
              </h3>
              <p className="text-xs font-mono text-neutral-400 mb-5 leading-relaxed">
                Verify your identity to unlock the full platform. It only takes a minute.
              </p>
              <ul className="space-y-3 mb-6">
                {[
                  'Rent professional equipment',
                  'List your own gear on the marketplace and start earning',
                  'Accept gigs and get paid',
                  'Priority support',
                ].map((perk) => (
                  <li key={perk} className="flex items-start gap-2.5 text-xs font-mono text-neutral-300">
                    <svg className="w-4 h-4 text-[#D4A843] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {perk}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard/verification"
                className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest px-6 py-3 bg-[#D4A843] text-black hover:bg-[#E5B954] transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                Verify Now
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Verification pending banner */}
      {verificationStatus === 'pending' && (
        <div className="bg-[#0A0A0B] border border-amber-500/30 p-6 mb-10">
          <div className="flex items-center gap-4">
            <Clock className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-mono font-bold text-amber-400">Verification processing</p>
              <p className="text-xs font-mono text-neutral-500 mt-1">
                Your documents are being processed. Verification is instant.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className={`grid grid-cols-1 gap-4 mb-10 ${isVerified ? 'sm:grid-cols-5' : 'sm:grid-cols-2'}`}>
        <StatCard label="Bookings" value={String(bookingsCount)} icon={Calendar} href="/dashboard/bookings" />
        <StatCard label="My Requests" value={String(requestsCount)} icon={FileText} href="/dashboard/creator-requests" />
        {isVerified && (
          <>
            <StatCard label="Gigs" value={String(gigsCount)} icon={Briefcase} href="/dashboard/gigs" />
            <StatCard label="Listings" value={String(listingsCount)} icon={Package} href="/dashboard/listings" />
            <StatCard label="Orders" value={String(ordersCount)} icon={ShoppingBag} href="/dashboard/orders" />
          </>
        )}
      </div>

      {/* Onboarding checklist (unverified users only) */}
      {!isVerified && (
        <div className="mb-10">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white mb-4">
            Get Started
          </h2>
          <div className="space-y-3">
            <ChecklistItem
              done={!!hasRequiredProfile}
              label="Complete your profile"
              description="Add your name, address, and phone number."
              href="/dashboard/profile"
            />
            <ChecklistItem
              done={bookingsCount > 0}
              label="Browse equipment"
              description="Explore professional gear available for rent."
              href="/smart-rentals"
            />
            <ChecklistItem
              done={isVerified}
              pending={verificationStatus === 'pending'}
              label={
                verificationStatus === 'pending'
                  ? 'Verification pending'
                  : verificationStatus === 'rejected'
                    ? 'Resubmit verification'
                    : 'Get verified (become a creator)'
              }
              description={
                verificationStatus === 'pending'
                  ? 'Your documents are being processed. This is instant.'
                  : verificationStatus === 'rejected'
                    ? 'Verification was rejected. Please resubmit.'
                    : 'Verification lets you list gear, accept gigs, and earn on the platform.'
              }
              href="/dashboard/verification"
            />
          </div>
        </div>
      )}

      {/* Quick actions */}
      <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white mb-4">
        Quick Actions
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <QuickAction
          icon={Search}
          title="Book Equipment"
          description="Browse and reserve professional gear."
          href="/smart-rentals"
        />
        {isVerified ? (
          <>
            <QuickAction
              icon={Package}
              title="List Your Gear"
              description="Earn by renting out your equipment."
              href="/dashboard/listings"
            />
            <QuickAction
              icon={Briefcase}
              title="View Gigs"
              description="See incoming gig requests from clients."
              href="/dashboard/gigs"
            />
          </>
        ) : (
          <>
            <QuickAction
              icon={Users}
              title="Hire a Creator"
              description="Find verified creators for your project."
              href="/smart-creators"
            />
            <QuickAction
              icon={Settings}
              title="Edit Profile"
              description="Update your name, phone, and details."
              href="/dashboard/profile"
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}) {
  return (
    <Link href={href} className="group block">
      <div className="bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6 hover:border-black/20 dark:hover:border-white/20 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <Icon className="w-4 h-4 text-neutral-400 dark:text-neutral-600 group-hover:text-black dark:group-hover:text-white transition-colors" />
          <ArrowRight className="w-3 h-3 text-neutral-300 dark:text-neutral-700 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </div>
        <p className="text-2xl font-display font-medium text-black dark:text-white">{value}</p>
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mt-1">{label}</p>
      </div>
    </Link>
  );
}

function ChecklistItem({
  done,
  pending,
  label,
  description,
  href,
}: {
  done: boolean;
  pending?: boolean;
  label: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="group block">
      <div className={`flex items-start gap-4 bg-neutral-100 dark:bg-[#0A0A0B] border p-4 hover:border-black/20 dark:hover:border-white/20 transition-colors ${
        pending
          ? 'border-amber-500/30 dark:border-amber-500/20'
          : 'border-black/5 dark:border-white/5'
      }`}>
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
            done
              ? 'border-emerald-500 bg-emerald-500'
              : pending
                ? 'border-amber-500 bg-amber-500'
                : 'border-neutral-300 dark:border-neutral-700'
          }`}
        >
          {done && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {pending && (
            <Clock className="w-3 h-3 text-white" />
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-mono font-bold ${
            done
              ? 'text-neutral-400 line-through'
              : pending
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-black dark:text-white'
          }`}>
            {label}
          </p>
          <p className={`text-xs mt-0.5 ${pending ? 'text-amber-500/70 dark:text-amber-400/70' : 'text-neutral-500'}`}>
            {description}
          </p>
        </div>
        <ArrowRight className="w-3 h-3 text-neutral-300 dark:text-neutral-700 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

function QuickAction({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="group block">
      <div className="h-full bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6 hover:border-black/20 dark:hover:border-white/20 transition-colors">
        <Icon className="w-5 h-5 text-neutral-400 dark:text-neutral-600 mb-4 group-hover:text-black dark:group-hover:text-white transition-colors" />
        <h3 className="text-sm font-mono font-bold text-black dark:text-white uppercase tracking-wide mb-1">
          {title}
        </h3>
        <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}
