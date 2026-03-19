'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    fetchNotifications();
    // Poll every 30 seconds
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchNotifications() {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setNotifications(data);
      }
    } catch {
      /* fetch failure shouldn't break UI */
    }
  }

  async function markAsRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    await fetch('/api/notifications/mark-all-read', { method: 'POST' });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-neutral-500 hover:text-white transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[8px] font-mono rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#0A0A0B] border border-white/10 shadow-xl z-50 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[9px] font-mono uppercase tracking-widest text-[#D4A843] hover:text-[#E5B954]"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs font-mono text-neutral-600">No notifications yet</p>
            </div>
          ) : (
            notifications.slice(0, 20).map(n => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${
                  !n.is_read ? 'bg-white/[0.02]' : ''
                }`}
                onClick={() => {
                  if (!n.is_read) markAsRead(n.id);
                  if (n.link) window.location.href = n.link;
                  setIsOpen(false);
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && (
                    <span className="w-1.5 h-1.5 bg-[#D4A843] rounded-full mt-1.5 flex-shrink-0" />
                  )}
                  <div className={!n.is_read ? '' : 'ml-3.5'}>
                    <p className="text-xs font-mono text-white">{n.title}</p>
                    <p className="text-[10px] font-mono text-neutral-500 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[9px] font-mono text-neutral-700 mt-1">
                      {new Date(n.created_at).toLocaleDateString('en-ZA', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}

          {notifications.length > 0 && (
            <Link
              href="/dashboard/notifications"
              className="block px-4 py-3 text-center text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
              onClick={() => setIsOpen(false)}
            >
              View All
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
