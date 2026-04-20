'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DashboardSidebarProps {
  isCreator: boolean;
}

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  creatorOnly?: boolean;
  hideForCreator?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Activity',
    items: [
      { href: '/dashboard', label: 'Overview', exact: true },
      { href: '/dashboard/bookings', label: 'Rentals' },
      { href: '/dashboard/creator-requests', label: 'Hires' },
      { href: '/dashboard/disputes', label: 'Disputes' },
      { href: '/dashboard/cart', label: 'Cart' },
    ],
  },
  {
    title: 'Studio',
    creatorOnly: true,
    items: [
      { href: '/dashboard/portfolio', label: 'Portfolio' },
      { href: '/dashboard/gigs', label: 'Gigs' },
      { href: '/dashboard/listings', label: 'Listings' },
      { href: '/dashboard/orders', label: 'Orders' },
      { href: '/dashboard/pricing', label: 'Pricing Guide' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard/profile', label: 'Profile' },
      { href: '/dashboard/banking', label: 'Payouts' },
      { href: '/dashboard/notifications', label: 'Notifications' },
    ],
  },
  {
    title: 'Account',
    hideForCreator: true,
    items: [
      { href: '/dashboard/profile', label: 'Profile' },
      { href: '/dashboard/notifications', label: 'Notifications' },
      { href: '/dashboard/verification', label: 'Get Verified' },
    ],
  },
];

export function DashboardSidebar({ isCreator }: DashboardSidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const groups = NAV_GROUPS.filter((g) => {
    if (g.creatorOnly && !isCreator) return false;
    if (g.hideForCreator && isCreator) return false;
    // For creator: show creator Account group (with Payouts); for regular: show regular Account group (with Get Verified)
    return true;
  });

  return (
    <nav className="space-y-6">
      {groups.map((group) => (
        <div key={group.title + (group.creatorOnly ? '-creator' : group.hideForCreator ? '-unverified' : '')}>
          <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-neutral-600 mb-2 px-3">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block text-[11px] font-mono py-2 px-3 rounded transition-colors ${
                  isActive(item.href, item.exact)
                    ? 'text-[#D4A843] bg-[#D4A843]/5 border-l-2 border-[#D4A843]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
