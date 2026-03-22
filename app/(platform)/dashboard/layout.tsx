export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/dashboard/SignOutButton';
import NotificationBell from '@/components/notifications/NotificationBell';
import { DashboardNav } from '@/components/dashboard/DashboardNav';

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
        <div className="border-b border-black/10 dark:border-white/10 pb-6 mb-10">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#D4A843]">
              {isCreator ? 'Creator Dashboard' : 'Dashboard'}
            </p>
            <NotificationBell />
          </div>
        </div>

        {/* Mobile: horizontal scrollable nav */}
        <div className="md:hidden mb-8 -mx-6 px-6 overflow-x-auto scrollbar-none">
          <DashboardNav isCreator={isCreator} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
          {/* Desktop sidebar */}
          <div className="hidden md:block">
            <DashboardNav isCreator={isCreator} vertical />
            <div className="border-t border-white/10 mt-4 pt-4">
              <SignOutButton />
            </div>
          </div>

          {/* Content */}
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

