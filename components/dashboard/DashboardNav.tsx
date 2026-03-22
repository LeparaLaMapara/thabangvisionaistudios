'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DashboardNavProps {
  isCreator: boolean;
  vertical?: boolean;
}

interface NavLink {
  href: string;
  label: string;
  exact?: boolean;
}

const BASE_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/cart', label: 'Cart' },
  { href: '/dashboard/bookings', label: 'Bookings' },
  { href: '/dashboard/creator-requests', label: 'My Requests' },
];

const CREATOR_LINKS: NavLink[] = [
  { href: '/dashboard/gigs', label: 'Gigs' },
  { href: '/dashboard/listings', label: 'List Your Gear' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/banking', label: 'Banking Details' },
];

const COMMON_LINKS: NavLink[] = [
  { href: '/dashboard/notifications', label: 'Notifications' },
];

const UNVERIFIED_LINKS: NavLink[] = [
  { href: '/dashboard/verification', label: 'Verification' },
];

export function DashboardNav({ isCreator, vertical }: DashboardNavProps) {
  const pathname = usePathname();

  const links = [
    ...BASE_LINKS,
    ...(isCreator ? CREATOR_LINKS : []),
    ...COMMON_LINKS,
    ...(!isCreator ? UNVERIFIED_LINKS : []),
  ];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  if (vertical) {
    return (
      <nav className="space-y-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`block text-[10px] font-mono uppercase tracking-widest py-2 px-3 transition-colors ${
              isActive(link.href, link.exact)
                ? 'text-[#D4A843] bg-[#D4A843]/5 border-l-2 border-[#D4A843]'
                : 'text-neutral-500 hover:text-white hover:bg-white/5'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex gap-1 min-w-max">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`text-[10px] font-mono uppercase tracking-widest py-2 px-3 whitespace-nowrap transition-colors ${
            isActive(link.href, link.exact)
              ? 'text-[#D4A843] border-b-2 border-[#D4A843]'
              : 'text-neutral-500 hover:text-white'
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
