'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function HeaderUbunyeBubble() {
  const pathname = usePathname();

  if (pathname === '/ubunye-ai-studio') return null;

  return (
    <Link
      href="/ubunye-ai-studio"
      className="ubunye-presence group flex items-center gap-3 relative"
      aria-label="Ask Ubunye"
    >
      {/* Orb container */}
      <div className="relative w-8 h-8 md:w-9 md:h-9 flex items-center justify-center">
        {/* Ambient glow — always visible */}
        <div className="absolute inset-0 rounded-full bg-[#D4A843]/10 group-hover:bg-[#D4A843]/20 blur-md transition-all duration-700 scale-150 group-hover:scale-[1.8]" />

        {/* Outer ring — breathes */}
        <div className="absolute inset-0 rounded-full border border-[#D4A843]/15 group-hover:border-[#D4A843]/30 transition-all duration-500 animate-[orb-breathe_4s_ease-in-out_infinite]" />

        {/* Core sphere */}
        <div className="relative w-4 h-4 md:w-[18px] md:h-[18px] rounded-full bg-gradient-to-br from-[#E8C96A] via-[#D4A843] to-[#B08A32] shadow-[0_0_12px_rgba(212,168,67,0.4),0_0_24px_rgba(212,168,67,0.15)] group-hover:shadow-[0_0_16px_rgba(212,168,67,0.6),0_0_32px_rgba(212,168,67,0.25)] group-hover:scale-110 transition-all duration-500 animate-[orb-pulse_3s_ease-in-out_infinite]" />

        {/* Orbit particle */}
        <div className="absolute inset-[-2px] rounded-full animate-[orb-orbit_8s_linear_infinite] pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full bg-[#D4A843] opacity-50 group-hover:opacity-80 shadow-[0_0_4px_rgba(212,168,67,0.6)] transition-opacity duration-500" />
        </div>
      </div>

      {/* Label — always visible */}
      <span className="text-[10px] font-mono tracking-[0.2em] text-neutral-400 group-hover:text-[#D4A843]/80 transition-colors duration-500 uppercase">
        Ask Ubunye
      </span>

      <style jsx>{`
        @keyframes orb-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.7; }
        }
        @keyframes orb-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes orb-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Link>
  );
}
