import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  children: React.ReactNode;
}

export function Card({ hover = false, children, className = '', ...props }: CardProps) {
  return (
    <div
      {...props}
      className={[
        'bg-[#0A0A0B]',
        'border border-white/5',
        hover
          ? 'hover:border-white/20 hover:scale-[1.01] transition-all duration-300'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
