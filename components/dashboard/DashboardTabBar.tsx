'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Home,
  ClipboardList,
  Clapperboard,
  User,
  Bell,
} from 'lucide-react';

interface DashboardTabBarProps {
  isCreator: boolean;
}

interface Tab {
  id: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPaths: string[];
  creatorOnly?: boolean;
}

const TABS: Tab[] = [
  {
    id: 'home',
    href: '/dashboard',
    label: 'Home',
    icon: Home,
    matchPaths: ['/dashboard'],
  },
  {
    id: 'activity',
    href: '/dashboard/bookings',
    label: 'Activity',
    icon: ClipboardList,
    matchPaths: [
      '/dashboard/bookings',
      '/dashboard/creator-requests',
      '/dashboard/disputes',
      '/dashboard/cart',
    ],
  },
  {
    id: 'studio',
    href: '/dashboard/portfolio',
    label: 'Studio',
    icon: Clapperboard,
    matchPaths: [
      '/dashboard/portfolio',
      '/dashboard/gigs',
      '/dashboard/listings',
      '/dashboard/orders',
      '/dashboard/pricing',
    ],
    creatorOnly: true,
  },
  {
    id: 'profile',
    href: '/dashboard/profile',
    label: 'Profile',
    icon: User,
    matchPaths: [
      '/dashboard/profile',
      '/dashboard/banking',
      '/dashboard/verification',
    ],
  },
  {
    id: 'alerts',
    href: '/dashboard/notifications',
    label: 'Alerts',
    icon: Bell,
    matchPaths: ['/dashboard/notifications'],
  },
];

export function DashboardTabBar({ isCreator }: DashboardTabBarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  const visibleTabs = TABS.filter((t) => !t.creatorOnly || isCreator);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function fetchUnread() {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setUnreadCount(data.filter((n: { is_read: boolean }) => !n.is_read).length);
        }
      }
    } catch { /* silent */ }
  }

  const isActive = (tab: Tab) => {
    if (tab.id === 'home') return pathname === '/dashboard';
    return tab.matchPaths.some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#0A0A0B] border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16">
        {visibleTabs.map((tab) => {
          const active = isActive(tab);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors relative ${
                active ? 'text-[#D4A843]' : 'text-neutral-500'
              }`}
            >
              <div className="relative">
                <Icon size={20} className={active ? 'text-[#D4A843]' : 'text-neutral-500'} />
                {tab.id === 'alerts' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-mono uppercase tracking-wider mt-1">
                {tab.label}
              </span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#D4A843] rounded-full" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
