export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getNotifications } from '@/lib/supabase/queries/notifications';
import NotificationsList from './NotificationsList';
import { DashboardSubTabs, ACCOUNT_TABS_CREATOR, ACCOUNT_TABS_USER } from '@/components/dashboard/DashboardSubTabs';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [notifications, { data: profile }] = await Promise.all([
    getNotifications(user.id),
    supabase.from('profiles').select('verification_status').eq('id', user.id).single(),
  ]);

  const isCreator = profile?.verification_status === 'verified';

  return (
    <div>
      <DashboardSubTabs tabs={isCreator ? ACCOUNT_TABS_CREATOR : ACCOUNT_TABS_USER} />
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">Alerts</h2>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Stay updated on your bookings and gig requests.
        </p>
      </div>
      <NotificationsList initialNotifications={notifications} />
    </div>
  );
}
