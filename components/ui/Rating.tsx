'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

type RatingSize = 'sm' | 'md' | 'lg';

interface RatingProps {
  value: number;
  max?: number;
  size?: RatingSize;
  readOnly?: boolean;
  onChange?: (value: number) => void;
  className?: string;
}

const SIZE_CLASSES: Record<RatingSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

export function Rating({
  value,
  max = 5,
  size = 'md',
  readOnly = false,
  onChange,
  className = '',
}: RatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const displayed = hovered ?? value;

  return (
    <div
      className={[
        'inline-flex items-center gap-0.5',
        readOnly ? '' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseLeave={() => !readOnly && setHovered(null)}
    >
      {Array.from({ length: max }, (_, i) => {
        const starIndex = i + 1;
        const filled = starIndex <= displayed;

        return (
          <button
            key={i}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(starIndex)}
            onMouseEnter={() => !readOnly && setHovered(starIndex)}
            className={[
              'transition-colors duration-150 disabled:cursor-default',
              filled
                ? 'text-accent-gold'
                : 'text-neutral-300 dark:text-neutral-600',
            ].join(' ')}
          >
            <Star className={[SIZE_CLASSES[size], filled ? 'fill-current' : ''].filter(Boolean).join(' ')} />
          </button>
        );
      })}
    </div>
  );
}
