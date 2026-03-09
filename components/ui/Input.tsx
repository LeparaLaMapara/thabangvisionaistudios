import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = '', ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={[
          'w-full bg-transparent',
          'border',
          error
            ? 'border-red-500'
            : 'border-black/20 dark:border-white/10',
          'text-black dark:text-white',
          'px-4 py-3 min-h-[44px] font-mono text-sm',
          'placeholder:text-neutral-300 dark:placeholder:text-neutral-700',
          'focus:outline-none',
          error
            ? 'focus:border-red-500'
            : 'focus:border-black dark:focus:border-white',
          'transition-colors duration-200',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {error && (
        <p className="mt-1.5 text-[10px] font-mono text-red-500">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-[10px] font-mono text-neutral-400 dark:text-neutral-600">
          {hint}
        </p>
      )}
    </div>
  );
}
