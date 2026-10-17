'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import {
  Home,
  ClipboardList,
  Clapperboard,
  User,
  Bell,
  ListChecks,
} from 'lucide-react';

interface DashboardTabBarProps {
  isCreator: boolean;
  /** People (roles_v1) is on: the Studio tab opens gear listings, not Gigs. */
  people?: boolean;
  /** Ubunye plans (ubunye_projects) is on: a Plans tab after Activity. */
  plans?: boolean;
}

interface Tab {
  id: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPaths: string[];
  creatorOnly?: boolean;
  /** Shown only with the plans flag on. */
  plansOnly?: boolean;
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
    id: 'plans',
    href: '/dashboard/plans',
    label: 'Plans',
    icon: ListChecks,
    matchPaths: ['/dashboard/plans'],
    plansOnly: true,
  },
  {
    id: 'studio',
    // Jobs first: a paid job waiting for an answer is the thing that needs a
    // creator most, and it used to be a second tap away (Portfolio opened).
    href: '/dashboard/gigs',
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

export function DashboardTabBar({ isCreator, people = false, plans = false }: DashboardTabBarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  const visibleTabs = TABS.filter((t) => (!t.creatorOnly || isCreator) && (!t.plansOnly || plans)).map((t) =>
    people && t.id === 'studio' ? { ...t, href: '/dashboard/listings' } : t,
  );

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setUnreadCount(data.filter((n: { is_read: boolean }) => !n.is_read).length);
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (active) await fetchUnread();
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => { active = false; clearInterval(interval); };
  }, [fetchUnread]);

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
                active ? 'text-[#D4A843]' : 'text-neutral-400'
              }`}
            >
              <div className="relative">
                <Icon size={20} className={active ? 'text-[#D4A843]' : 'text-neutral-400'} />
                {tab.id === 'alerts' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-xs font-mono uppercase tracking-wider mt-1">
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
