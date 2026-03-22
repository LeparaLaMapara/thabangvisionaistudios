'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const ADMIN_LINKS = [
  // Content management
  { label: 'Dashboard', href: '/admin' },
  { label: 'Projects', href: '/admin/projects' },
  { label: 'Rentals', href: '/admin/rentals' },
  { label: 'Import', href: '/admin/rentals/import' },
  { label: 'Press', href: '/admin/press' },
  { label: 'Careers', href: '/admin/careers' },
  // Operations
  { label: 'Bookings', href: '/admin/bookings' },
  { label: 'Service Bookings', href: '/admin/service-bookings' },
  { label: 'Verifications', href: '/admin/verifications' },
  { label: 'Creator Requests', href: '/admin/creator-requests' },
  { label: 'Users', href: '/admin/users' },
];

export function AdminNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Desktop nav — hidden on mobile */}
      <nav className="hidden md:flex items-center gap-5 overflow-x-auto scrollbar-hide min-w-0">
        {ADMIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`text-[10px] font-mono uppercase tracking-widest flex-shrink-0 transition-colors ${
              isActive(link.href)
                ? 'text-[#D4A843]'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Mobile hamburger — visible only on mobile */}
      <button
        className="md:hidden text-white p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Close admin menu' : 'Open admin menu'}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 right-0 bg-neutral-900 border-b border-white/10 overflow-hidden md:hidden z-50"
          >
            <nav className="flex flex-col py-2 px-4">
              {ADMIN_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`text-[10px] font-mono uppercase tracking-widest transition-colors py-3 border-b border-white/5 last:border-0 min-h-[44px] flex items-center ${
                    isActive(link.href)
                      ? 'text-[#D4A843]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
