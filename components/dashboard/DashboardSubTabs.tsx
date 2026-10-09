'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SubTab {
  href: string;
  label: string;
}

interface DashboardSubTabsProps {
  tabs: SubTab[];
}

/**
 * Horizontal pill-style sub-tabs shown at the top of each main section.
 * Used inside Activity (Rentals / Hires / Cart) and Studio (Portfolio / Gigs / Listings / Orders).
 * Visible on mobile where the bottom tab bar groups these pages together.
 */
export function DashboardSubTabs({ tabs }: DashboardSubTabsProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <nav aria-label="Section" className="flex gap-2 mb-6 overflow-x-auto scrollbar-none md:hidden">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={isActive(tab.href) ? 'page' : undefined}
          className={`inline-flex items-center min-h-[44px] text-xs font-mono uppercase tracking-wider px-4 rounded-full whitespace-nowrap transition-colors ${
            isActive(tab.href)
              ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/30'
              : 'text-neutral-400 border border-white/10 hover:text-white hover:border-white/20'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

// Pre-defined sub-tab sets
export const ACTIVITY_TABS: SubTab[] = [
  { href: '/dashboard/bookings', label: 'Rentals' },
  { href: '/dashboard/creator-requests', label: 'Hires' },
  { href: '/dashboard/cart', label: 'Cart' },
];

export const STUDIO_TABS: SubTab[] = [
  { href: '/dashboard/portfolio', label: 'Portfolio' },
  { href: '/dashboard/gigs', label: 'Gigs' },
  { href: '/dashboard/listings', label: 'Listings' },
  { href: '/dashboard/orders', label: 'Orders' },
];

// Creator account tabs (verified — has payouts)
export const ACCOUNT_TABS_CREATOR: SubTab[] = [
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/banking', label: 'Payouts' },
  { href: '/dashboard/notifications', label: 'Notifications' },
];

// Regular user account tabs (unverified — has verification CTA)
export const ACCOUNT_TABS_USER: SubTab[] = [
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/notifications', label: 'Notifications' },
  { href: '/dashboard/verification', label: 'Get Verified' },
];

/** @deprecated Use ACCOUNT_TABS_CREATOR or ACCOUNT_TABS_USER */
export const ACCOUNT_TABS = ACCOUNT_TABS_CREATOR;
