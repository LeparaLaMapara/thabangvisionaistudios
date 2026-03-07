type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default:  'text-neutral-500 dark:text-neutral-400 bg-neutral-500/10',
  success:  'text-emerald-400 bg-emerald-500/10',
  warning:  'text-amber-400 bg-amber-500/10',
  error:    'text-red-400 bg-red-500/10',
  info:     'text-blue-400 bg-blue-500/10',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-block',
        'text-[9px] font-mono uppercase tracking-widest',
        'px-2 py-0.5',
        VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
