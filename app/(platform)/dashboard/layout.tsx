export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/dashboard/SignOutButton';
import NotificationBell from '@/components/notifications/NotificationBell';
import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { SuspensionBanner } from '@/components/dashboard/SuspensionBanner';
import { RedirectToLogin } from '@/components/auth/RedirectToLogin';
import { PeopleModeProvider } from '@/components/dashboard/PeopleMode';
import { getFlag } from '@/lib/features';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth.getUser();
  // Back to this exact page after signing in (the layout cannot see its own
  // path on the server, so the redirect carrying ?next= runs in the browser).
  if (!user) {
    return (
      <Suspense fallback={null}>
        <RedirectToLogin />
      </Suspense>
    );
  }

  // Fetch verification status and what they came to do
  const supabase = await createClient();
  const [{ data: profile }, { data: { user: authUser } }, people, plans] = await Promise.all([
    supabase
      .from('profiles')
      .select('verification_status, is_suspended, suspension_reason, onboarding_completed_at')
      .eq('id', user.id)
      .single(),
    supabase.auth.getUser(),
    getFlag('roles_v1'),
    getFlag('ubunye_projects'),
  ]);

  const isVerified = profile?.verification_status === 'verified';
  // Someone who said they came to rent gear or hire a creator, and never
  // started offering gear or services, is a renter: verifying their ID does
  // not make them a creator, so they see renter words and no studio tools.
  const intent = authUser?.user_metadata?.intent;
  const isRenterOnly = (intent === 'rent' || intent === 'hire') && !profile?.onboarding_completed_at;
  const isCreator = isVerified && !isRenterOnly;
  const isSuspended = profile?.is_suspended === true;
  const suspensionReason = (profile?.suspension_reason as string) ?? null;

  return (
    <div className="min-h-[calc(100vh-200px)]">
      <div className="max-w-6xl mx-auto px-6 py-12 pb-24 md:pb-12">
        {/* Dashboard Header */}
        <div className="border-b border-white/10 pb-6 mb-10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono uppercase tracking-[0.3em] text-[#D4A843]">
              {isCreator ? 'Creator Dashboard' : 'Dashboard'}
            </p>
            <NotificationBell />
          </div>
        </div>

        {isSuspended && (
          <SuspensionBanner reason={suspensionReason} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
          {/* Desktop sidebar — grouped sections */}
          <div className="hidden md:block">
            <DashboardSidebar isCreator={isCreator} isVerified={isVerified} people={people} plans={plans} />
            <div className="border-t border-white/10 mt-6 pt-4">
              <SignOutButton />
            </div>
          </div>

          {/* Content */}
          <div><PeopleModeProvider on={people}>{children}</PeopleModeProvider></div>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <DashboardTabBar isCreator={isCreator} people={people} />
    </div>
  );
}
