'use client';

import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';

interface AskUbunyeProps {
  prompt: string;
  label?: string;
  /** Sit above a bar pinned to the bottom of the screen on phones (the gear page's book bar). */
  raised?: boolean;
}

/**
 * The floating "ask Ubunye" button.
 *
 * On phones it used to stretch across the bottom of the screen and sat on top
 * of the page's own main button ("Sign in to book: ZAR 2,600" on a gear page).
 * The page's action comes first: on phones this is now a small round button in
 * the corner (its label kept for screen readers); on larger screens it keeps
 * its label.
 */
export function AskUbunyeButton({ prompt, label = 'Ask Ubunye', raised = false }: AskUbunyeProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/ubunye-ai-studio?prompt=${encodeURIComponent(prompt)}`)}
      aria-label={label}
      className={`fixed z-50 flex items-center justify-center gap-2 bg-[#D4A843] text-[#050505] rounded-full font-semibold text-sm shadow-lg hover:shadow-[0_0_20px_rgba(212,168,67,0.3)] transition-all duration-300 ${raised ? 'bottom-24' : 'bottom-5'} right-4 w-12 h-12 md:w-auto md:h-auto md:px-5 md:py-3 md:bottom-8 md:right-8`}
    >
      <MessageCircle className="w-5 h-5 md:hidden" aria-hidden="true" />
      <span className="hidden md:inline-block w-2 h-2 rounded-full bg-[#050505] animate-pulse" aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
