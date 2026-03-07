import type { SelectHTMLAttributes } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  className = '',
  ...props
}: SelectProps) {
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
      <select
        id={inputId}
        {...props}
        className={[
          'w-full bg-transparent',
          'border',
          error
            ? 'border-red-500'
            : 'border-black/20 dark:border-white/10',
          'text-black dark:text-white',
          'px-4 py-3 font-mono text-sm',
          'focus:outline-none',
          error
            ? 'focus:border-red-500'
            : 'focus:border-black dark:focus:border-white',
          'transition-colors duration-200',
          'cursor-pointer',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1.5 text-[10px] font-mono text-red-500">{error}</p>
      )}
    </div>
  );
}
