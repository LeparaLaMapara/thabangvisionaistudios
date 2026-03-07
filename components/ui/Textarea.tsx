import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  maxLength?: number;
  currentLength?: number;
}

export function Textarea({
  label,
  error,
  hint,
  id,
  maxLength,
  currentLength,
  className = '',
  ...props
}: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const charCount = currentLength ?? (typeof props.value === 'string' ? props.value.length : 0);

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
      <textarea
        id={inputId}
        maxLength={maxLength}
        {...props}
        className={[
          'w-full bg-transparent',
          'border',
          error
            ? 'border-red-500'
            : 'border-black/20 dark:border-white/10',
          'text-black dark:text-white',
          'px-4 py-3 font-mono text-sm',
          'placeholder:text-neutral-300 dark:placeholder:text-neutral-700',
          'focus:outline-none',
          error
            ? 'focus:border-red-500'
            : 'focus:border-black dark:focus:border-white',
          'transition-colors duration-200',
          'resize-y min-h-[100px]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      <div className="flex justify-between mt-1.5">
        <div>
          {error && (
            <p className="text-[10px] font-mono text-red-500">{error}</p>
          )}
          {hint && !error && (
            <p className="text-[10px] font-mono text-neutral-400 dark:text-neutral-600">
              {hint}
            </p>
          )}
        </div>
        {maxLength != null && (
          <p className="text-[10px] font-mono text-neutral-400 dark:text-neutral-600 ml-auto">
            {charCount}/{maxLength}
          </p>
        )}
      </div>
    </div>
  );
}
