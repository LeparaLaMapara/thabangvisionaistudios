export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/dashboard/SignOutButton';
import NotificationBell from '@/components/notifications/NotificationBell';
import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { SuspensionBanner } from '@/components/dashboard/SuspensionBanner';

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
    .select('verification_status, is_suspended, suspension_reason')
    .eq('id', user.id)
    .single();

  const isCreator = profile?.verification_status === 'verified';
  const isSuspended = profile?.is_suspended === true;
  const suspensionReason = (profile?.suspension_reason as string) ?? null;

  return (
    <div className="min-h-[calc(100vh-200px)]">
      <div className="max-w-6xl mx-auto px-6 py-12 pb-24 md:pb-12">
        {/* Dashboard Header */}
        <div className="border-b border-white/10 pb-6 mb-10">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#D4A843]">
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
            <DashboardSidebar isCreator={isCreator} />
            <div className="border-t border-white/10 mt-6 pt-4">
              <SignOutButton />
            </div>
          </div>

          {/* Content */}
          <div>{children}</div>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <DashboardTabBar isCreator={isCreator} />
    </div>
  );
}
