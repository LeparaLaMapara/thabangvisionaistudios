export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminShell } from '@/components/admin/shell/AdminShell';

/**
 * Auth guard for all /admin/* routes.
 * Unauthenticated requests are redirected to /login.
 * Non-admin users are redirected to /dashboard.
 * Authenticated admins see the admin frame: the side menu, search and counts.
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

  return <AdminShell email={user.email ?? ''}>{children}</AdminShell>;
}
