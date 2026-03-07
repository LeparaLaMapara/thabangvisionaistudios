'use client';

import { motion } from 'framer-motion';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, { ring: string; text: string }> = {
  sm: { ring: 'w-4 h-4 border-[1.5px]', text: 'text-[9px]' },
  md: { ring: 'w-6 h-6 border-2', text: 'text-[10px]' },
  lg: { ring: 'w-10 h-10 border-2', text: 'text-xs' },
};

export function LoadingSpinner({ size = 'md', label, className = '' }: LoadingSpinnerProps) {
  const cfg = SIZE_CLASSES[size];

  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        className={[
          cfg.ring,
          'rounded-full',
          'border-black/20 dark:border-white/20',
          'border-t-black dark:border-t-white',
        ].join(' ')}
      />
      {label && (
        <p
          className={[
            cfg.text,
            'font-mono uppercase tracking-widest',
            'text-neutral-500 dark:text-neutral-400',
          ].join(' ')}
        >
          {label}
        </p>
      )}
    </div>
  );
}
