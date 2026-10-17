'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PLAN } from '@/lib/constants';

/**
 * "Plan" in the phone header, next to the menu button (owner 2026-10-17:
 * name the job, keep the brain in the background). On wide screens Plan is
 * in the menu itself, so this is phones only. Hidden on the Plan page.
 */
export function HeaderPlanLink() {
  const pathname = usePathname();

  if (pathname === PLAN.href) return null;

  return (
    <Link
      href={PLAN.href}
      className="group flex items-center gap-2 min-h-[44px] min-w-[44px] px-1 justify-center"
    >
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#D4A843]" />
      <span className="text-xs font-mono tracking-[0.2em] text-neutral-300 group-hover:text-[#D4A843] transition-colors duration-300 uppercase">
        {PLAN.label}
      </span>
    </Link>
  );
}
