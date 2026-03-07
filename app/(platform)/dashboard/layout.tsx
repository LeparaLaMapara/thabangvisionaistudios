import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth guard for all /dashboard/* routes.
 * Unauthenticated requests are redirected to /login.
 * Authenticated users see a sidebar navigation.
 */
export default async function DashboardLayout({
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
    <div className="min-h-[calc(100vh-200px)]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Dashboard Header */}
        <div className="border-b border-black/10 dark:border-white/10 pb-8 mb-10">
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
            Creator Dashboard
          </p>
          <h1 className="text-2xl font-display font-medium uppercase text-black dark:text-white">
            My Studio
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
          {/* Sidebar */}
          <nav className="space-y-1">
            <DashboardLink href="/dashboard">Overview</DashboardLink>
            <DashboardLink href="/dashboard/profile">Profile</DashboardLink>
            <DashboardLink href="/dashboard/bookings">Bookings</DashboardLink>
            <DashboardLink href="/dashboard/listings">Listings</DashboardLink>
            <DashboardLink href="/dashboard/orders">Orders</DashboardLink>
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
