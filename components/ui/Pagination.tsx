'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = buildPageNumbers(currentPage, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={[
        'flex items-center justify-center gap-1',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        className={BTN_BASE + ' ' + NAV_BTN}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      {/* Page numbers */}
      {pages.map((page, i) =>
        page === '...' ? (
          <span
            key={`ellipsis-${i}`}
            className="px-1 text-[10px] font-mono text-neutral-400 select-none"
          >
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page as number)}
            aria-current={page === currentPage ? 'page' : undefined}
            className={[
              BTN_BASE,
              'min-w-[32px] h-8',
              page === currentPage
                ? 'bg-black dark:bg-white text-white dark:text-black'
                : 'text-neutral-500 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5',
            ].join(' ')}
          >
            {page}
          </button>
        ),
      )}

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
        className={BTN_BASE + ' ' + NAV_BTN}
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </nav>
  );
}

const BTN_BASE =
  'inline-flex items-center justify-center text-[10px] font-mono uppercase tracking-widest transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed';

const NAV_BTN =
  'w-8 h-8 text-neutral-500 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5';

function buildPageNumbers(
  current: number,
  total: number,
): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [1];

  if (current > 3) pages.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push('...');

  pages.push(total);
  return pages;
}
