'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center flex-wrap gap-1 text-xs font-mono uppercase tracking-widest text-neutral-400 ${className}`}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-neutral-400" />}
            {isLast || !item.href ? (
              <span className={isLast ? 'text-neutral-300' : ''}>
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-white transition-colors"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
