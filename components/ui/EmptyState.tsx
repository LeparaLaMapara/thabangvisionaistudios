import Link from 'next/link';
import type { ReactNode } from 'react';

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        'border border-dashed border-black/10 dark:border-white/10',
        'p-16',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && (
        <div className="text-neutral-300 dark:text-neutral-700 mb-6">{icon}</div>
      )}

      <h3 className="text-sm font-display font-medium uppercase tracking-tight text-black dark:text-white mb-2">
        {title}
      </h3>

      {description && (
        <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400 max-w-xs leading-relaxed mb-8">
          {description}
        </p>
      )}

      {action && (
        <>
          {action.href ? (
            <Link
              href={action.href}
              className="inline-block text-[10px] font-mono uppercase tracking-widest text-white dark:text-black bg-black dark:bg-white px-6 py-3 hover:opacity-80 transition-opacity"
            >
              {action.label}
            </Link>
          ) : (
            <button
              onClick={action.onClick}
              className="text-[10px] font-mono uppercase tracking-widest text-white dark:text-black bg-black dark:bg-white px-6 py-3 hover:opacity-80 transition-opacity"
            >
              {action.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
