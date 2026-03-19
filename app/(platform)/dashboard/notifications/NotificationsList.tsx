'use client';

import { useState } from 'react';

type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationsList({
  initialNotifications,
}: {
  initialNotifications: Notification[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  async function markAsRead(id: string) {
    const res = await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
    if (res.ok) {
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true } : n)),
      );
    }
  }

  async function markAllRead() {
    const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' });
    if (res.ok) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    }
  }

  if (notifications.length === 0) {
    return (
      <div className="border border-white/5 px-6 py-16 text-center">
        <p className="text-xs font-mono text-neutral-600">No notifications yet.</p>
        <p className="text-[10px] font-mono text-neutral-700 mt-2">
          You will be notified when you receive gig requests or booking updates.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unreadCount > 0 && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-mono text-neutral-500">
            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
          </p>
          <button
            onClick={markAllRead}
            className="text-[9px] font-mono uppercase tracking-widest text-[#D4A843] hover:text-[#E5B954] transition-colors"
          >
            Mark all as read
          </button>
        </div>
      )}

      <div className="border border-white/5 divide-y divide-white/5">
        {notifications.map(n => (
          <div
            key={n.id}
            className={`px-5 py-4 transition-colors ${
              !n.is_read ? 'bg-white/[0.02]' : ''
            } ${n.link ? 'cursor-pointer hover:bg-white/5' : ''}`}
            onClick={() => {
              if (!n.is_read) markAsRead(n.id);
              if (n.link) window.location.href = n.link;
            }}
          >
            <div className="flex items-start gap-3">
              {!n.is_read && (
                <span className="w-1.5 h-1.5 bg-[#D4A843] rounded-full mt-1.5 flex-shrink-0" />
              )}
              <div className={!n.is_read ? '' : 'ml-[18px]'}>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-mono text-white">{n.title}</p>
                  <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-700 bg-white/5 px-2 py-0.5">
                    {n.type.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-neutral-500 mt-1">{n.body}</p>
                <p className="text-[9px] font-mono text-neutral-700 mt-2">
                  {new Date(n.created_at).toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
