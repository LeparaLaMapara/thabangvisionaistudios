export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getNotifications } from '@/lib/supabase/queries/notifications';
import NotificationsList from './NotificationsList';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');

  const notifications = await getNotifications(user.id);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">Notifications</h2>
        <p className="text-xs font-mono text-neutral-500 mt-2">
          Stay updated on your bookings and gig requests.
        </p>
      </div>
      <NotificationsList initialNotifications={notifications} />
    </div>
  );
}
