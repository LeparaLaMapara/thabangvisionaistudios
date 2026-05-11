'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GoldenSphere } from '@/components/ubunye/GoldenSphere';

export function HeaderUbunyeBubble() {
  const pathname = usePathname();

  if (pathname === '/ubunye-ai-studio') return null;

  return (
    <Link
      href="/ubunye-ai-studio"
      className="flex items-center gap-2.5 bg-[#D4A843] text-[#050505] px-5 py-2 rounded-full font-mono font-bold text-xs tracking-widest uppercase hover:bg-[#E8C96A] transition-all duration-300 shadow-[0_0_20px_rgba(212,168,67,0.15)] hover:shadow-[0_0_30px_rgba(212,168,67,0.3)]"
    >
      <div className="w-5 h-5 -ml-0.5">
        <GoldenSphere className="w-full h-full" />
      </div>
      Ask Ubunye
    </Link>
  );
}
