'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DashboardSidebarProps {
  /** Offers gear or services (verified, and not a renter-only account): sees the studio tools and payouts. */
  isCreator: boolean;
  /** ID check done. Defaults to isCreator for callers that only pass that. */
  isVerified?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const ACTIVITY: NavGroup = {
  title: 'Activity',
  items: [
    { href: '/dashboard', label: 'Overview', exact: true },
    { href: '/dashboard/bookings', label: 'Rentals' },
    { href: '/dashboard/creator-requests', label: 'Hires' },
    { href: '/dashboard/disputes', label: 'Disputes' },
    { href: '/dashboard/cart', label: 'Cart' },
  ],
};

const STUDIO_TOOLS: NavGroup = {
  title: 'Studio',
  items: [
    { href: '/dashboard/gigs', label: 'Gigs' },
    { href: '/dashboard/portfolio', label: 'Portfolio' },
    { href: '/dashboard/listings', label: 'Listings' },
    { href: '/dashboard/orders', label: 'Orders' },
    { href: '/dashboard/pricing', label: 'Pricing Guide' },
  ],
};

/**
 * The groups a person sees. One "Account" group for everyone (there used to
 * be two for anyone not verified): payouts only for creators, "Get verified"
 * until the ID check is done, and a way in to offering gear or services for
 * a verified renter.
 */
export function sidebarGroups(isCreator: boolean, isVerified: boolean): NavGroup[] {
  const account: NavItem[] = [{ href: '/dashboard/profile', label: 'Profile' }];
  if (isCreator) account.push({ href: '/dashboard/banking', label: 'Payouts' });
  account.push({ href: '/dashboard/notifications', label: 'Notifications' });
  if (!isVerified) account.push({ href: '/dashboard/verification', label: 'Get Verified' });
  if (isVerified && !isCreator) account.push({ href: '/onboarding', label: 'Offer gear or services' });

  return [
    ACTIVITY,
    ...(isCreator ? [STUDIO_TOOLS] : []),
    { title: 'Account', items: account },
  ];
}

export function DashboardSidebar({ isCreator, isVerified = isCreator }: DashboardSidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const groups = sidebarGroups(isCreator, isVerified);

  return (
    <nav className="space-y-6">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400 mb-2 px-3">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block text-xs font-mono py-2 px-3 rounded transition-colors ${
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
