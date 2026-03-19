import { createClient } from '@/lib/supabase/server';

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export async function getNotifications(userId: string): Promise<Notification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[getNotifications]', error.message);
    return [];
  }
  return (data as Notification[]) ?? [];
}

export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    console.error('[getUnreadCount]', error.message);
    return 0;
  }
  return count ?? 0;
}
