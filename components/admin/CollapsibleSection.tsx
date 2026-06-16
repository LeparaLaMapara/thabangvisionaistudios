'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function CollapsibleSection({
  label,
  badge,
  children,
  defaultOpen = true,
  id,
}: {
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 mb-3 group cursor-pointer"
      >
        <ChevronDown
          className={`w-3 h-3 text-neutral-700 group-hover:text-neutral-500 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        />
        <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-600 group-hover:text-neutral-500 transition-colors flex items-center gap-2">
          {label}
          {badge}
        </p>
      </button>
      {open && children}
    </section>
  );
}
