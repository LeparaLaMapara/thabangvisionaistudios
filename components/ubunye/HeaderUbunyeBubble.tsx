'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function HeaderUbunyeBubble() {
  const pathname = usePathname();

  if (pathname === '/ubunye-ai-studio') return null;

  return (
    <Link
      href="/ubunye-ai-studio"
      className="flex items-center gap-2.5 bg-[#D4A843] text-[#050505] px-5 py-2 font-mono font-bold text-xs tracking-widest uppercase hover:bg-[#E8C96A] transition-all duration-300 shadow-[0_0_20px_rgba(212,168,67,0.15)] hover:shadow-[0_0_30px_rgba(212,168,67,0.3)]"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#050505] opacity-30" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#050505]" />
      </span>
      Ask Ubunye
    </Link>
  );
}
