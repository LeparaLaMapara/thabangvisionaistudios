export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/dashboard/SignOutButton';
import NotificationBell from '@/components/notifications/NotificationBell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  // Fetch verification status to determine role
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('id', user.id)
    .single();

  const isCreator = profile?.verification_status === 'verified';

  return (
    <div className="min-h-[calc(100vh-200px)]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Dashboard Header */}
        <div className="border-b border-black/10 dark:border-white/10 pb-8 mb-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                {isCreator ? 'Creator Dashboard' : 'Dashboard'}
              </p>
              <h1 className="text-2xl font-display font-medium uppercase text-black dark:text-white">
                My Studio
              </h1>
            </div>
            <NotificationBell />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
          {/* Sidebar */}
          <nav className="space-y-1">
            <DashboardLink href="/dashboard">Overview</DashboardLink>
            <DashboardLink href="/dashboard/profile">Profile</DashboardLink>
            <DashboardLink href="/dashboard/bookings">Bookings</DashboardLink>
            <DashboardLink href="/dashboard/creator-requests">My Requests</DashboardLink>
            {isCreator && (
              <>
                <DashboardLink href="/dashboard/gigs">Gigs</DashboardLink>
                <DashboardLink href="/dashboard/listings">List Your Gear</DashboardLink>
                <DashboardLink href="/dashboard/orders">Orders</DashboardLink>
              </>
            )}
            <DashboardLink href="/dashboard/notifications">Notifications</DashboardLink>
            {!isCreator && (
              <DashboardLink href="/dashboard/verification">Verification</DashboardLink>
            )}
            <div className="border-t border-white/10 mt-4 pt-4">
              <SignOutButton />
            </div>
          </nav>

          {/* Content */}
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

function DashboardLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-black dark:hover:text-white py-2 px-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      {children}
    </Link>
  );
}
