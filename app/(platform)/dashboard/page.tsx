export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { auth } from '@/lib/auth';
import { getProfileById } from '@/lib/supabase/queries/profiles';
import { Calendar, Package, ShoppingBag, ArrowRight, User, Search, ShieldCheck } from 'lucide-react';

export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const user = await auth.getUser();
  const supabase = await createClient();

  const profile = user ? await getProfileById(user.id) : null;

  // Fetch real counts from Supabase (silently return 0 if tables don't exist)
  const [bookingsResult, listingsResult, ordersResult] = await Promise.all([
    user
      ? supabase
          .from('equipment_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
      : { count: 0 },
    user
      ? supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('deleted_at', null)
      : { count: 0 },
    user
      ? supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      : { count: 0 },
  ]);

  const bookingsCount = ('count' in bookingsResult ? bookingsResult.count : 0) ?? 0;
  const listingsCount = ('count' in listingsResult ? listingsResult.count : 0) ?? 0;
  const ordersCount = ('count' in ordersResult ? ordersResult.count : 0) ?? 0;

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Creator';
  const hasProfile = profile && (profile.bio || profile.avatar_url || (profile.skills && profile.skills.length > 0));
  const isVerified = profile?.is_verified ?? false;

  return (
    <div>
      {/* Welcome hero */}
      <div className="mb-10">
        <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-3 block">
          Dashboard
        </span>
        <h1 className="text-3xl md:text-4xl font-display font-medium uppercase text-black dark:text-white tracking-tight">
          Welcome back, <span className="text-neutral-400 dark:text-neutral-500">{displayName}</span>
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 font-mono mt-3">
          {isVerified
            ? 'You are a verified creator. List gear, book equipment, and manage your orders.'
            : 'Complete your profile and get verified to unlock all features.'}
        </p>
      </div>

      {/* Stat cards — real counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard label="Bookings" value={String(bookingsCount)} icon={Calendar} href="/dashboard/bookings" />
        <StatCard label="Listings" value={String(listingsCount)} icon={Package} href="/dashboard/listings" />
        <StatCard label="Orders" value={String(ordersCount)} icon={ShoppingBag} href="/dashboard/orders" />
      </div>

      {/* Onboarding checklist (only show if profile incomplete) */}
      {!hasProfile || !isVerified ? (
        <div className="mb-10">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-black dark:text-white mb-4">
            Get Started
          </h2>
          <div className="space-y-3">
            <ChecklistItem
              done={!!hasProfile}
              label="Complete your profile"
              description="Add a bio, avatar, and skills to stand out."
              href="/dashboard/profile"
            />
            <ChecklistItem
              done={bookingsCount > 0 || listingsCount > 0}
              label="Browse equipment"
              description="Explore professional gear available for rent."
              href="/smart-rentals"
            />
            <ChecklistItem
              done={isVerified}
              label="Get verified"
              description="Verification lets you list your own gear for rent."
              href="/dashboard/verification"
            />
          </div>
        </div>
      ) : null}

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
        <QuickAction
          icon={Package}
          title="List Your Gear"
          description="Earn by renting out your equipment."
          href="/dashboard/listings"
        />
        <QuickAction
          icon={User}
          title="Edit Profile"
          description="Update your bio, avatar, and skills."
          href="/dashboard/profile"
        />
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
  label,
  description,
  href,
}: {
  done: boolean;
  label: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="group block">
      <div className="flex items-start gap-4 bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-4 hover:border-black/20 dark:hover:border-white/20 transition-colors">
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
            done
              ? 'border-emerald-500 bg-emerald-500'
              : 'border-neutral-300 dark:border-neutral-700'
          }`}
        >
          {done && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-mono font-bold ${done ? 'text-neutral-400 line-through' : 'text-black dark:text-white'}`}>
            {label}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
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
