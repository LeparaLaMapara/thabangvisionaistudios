import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { STUDIO } from '@/lib/constants';

/**
 * Auth guard for all /admin/* routes.
 * Unauthenticated requests are redirected to /login.
 * Authenticated users see the shared admin topbar.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-neutral-950 text-white">

      {/* Admin Topbar */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-900/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">

          {/* Left: brand + nav */}
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white select-none">
              {STUDIO.shortName.toUpperCase()}
            </span>
            <span className="text-white/20 text-xs">|</span>
            <nav className="flex items-center gap-5">
              <Link
                href="/admin"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/admin/projects"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Projects
              </Link>
              <Link
                href="/admin/rentals"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Rentals
              </Link>
              <Link
                href="/admin/careers"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Careers
              </Link>
              <Link
                href="/admin/bookings"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Bookings
              </Link>
              <Link
                href="/admin/press"
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors"
              >
                Press
              </Link>
            </nav>
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
