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
      className="flex items-center gap-1.5 text-[#D4A843]/70 hover:text-[#D4A843] transition-colors group"
    >
      <div className="w-4 h-4 md:w-[18px] md:h-[18px]">
        <GoldenSphere className="w-full h-full" />
      </div>
      <span className="hidden xl:inline text-[10px] font-mono tracking-widest uppercase">
        Ask Ubunye
      </span>
    </Link>
  );
}
