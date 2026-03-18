export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { AdminNav } from '@/components/admin/AdminNav';
import { STUDIO } from '@/lib/constants';

/**
 * Auth guard for all /admin/* routes.
 * Unauthenticated requests are redirected to /login.
 * Non-admin users are redirected to /dashboard.
 * Authenticated admins see the shared admin topbar.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth.getUser();

  if (!user) redirect('/login');

  // C3: Verify user is an admin — not just authenticated
  const isAdminUser = await auth.isAdmin(user.id, user.email);
  if (!isAdminUser) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">

      {/* Admin Topbar */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-900/80 backdrop-blur-md relative">
        <div className="max-w-7xl mx-auto px-3 md:px-6 h-14 flex items-center justify-between gap-3 md:gap-4">

          {/* Left: brand + nav */}
          <div className="flex items-center gap-4 md:gap-6 min-w-0 flex-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white select-none flex-shrink-0">
              {STUDIO.shortName.toUpperCase()}
            </span>
            <span className="text-white/20 text-xs flex-shrink-0 hidden md:block">|</span>
            <AdminNav />
          </div>

          {/* Right: user email + logout */}
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-[10px] font-mono text-neutral-600 truncate max-w-[200px]">
              {user.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main>
        {children}
      </main>
    </div>
  );
}
