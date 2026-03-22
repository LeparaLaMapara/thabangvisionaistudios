'use client';

import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-white text-black hover:bg-neutral-200',
  secondary:
    'bg-neutral-800 text-white hover:bg-neutral-700',
  outline:
    'border border-white/20 text-white hover:bg-white hover:text-black',
  danger:
    'bg-red-600 text-white hover:bg-red-700',
  ghost:
    'text-white hover:bg-white/5',
  accent:
    'bg-[#D4A843] text-black hover:opacity-80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-[9px]',
  md: 'px-6 py-3 text-[10px]',
  lg: 'px-8 py-4 text-xs',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center gap-2',
        'font-mono tracking-widest uppercase',
        'transition-all duration-200',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        loading ? 'pointer-events-none' : '',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
      {children}
    </button>
  );
}
