'use client';

import { useRouter } from 'next/navigation';

interface AskUbunyeProps {
  prompt: string;
  label?: string;
}

export function AskUbunyeButton({ prompt, label = 'Ask Ubunye' }: AskUbunyeProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/ubunye-ai-studio?prompt=${encodeURIComponent(prompt)}`)}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#D4A843] text-[#050505] px-5 py-3 rounded-full font-semibold text-sm shadow-lg hover:shadow-[0_0_20px_rgba(212,168,67,0.3)] transition-all duration-300 max-md:left-4 max-md:right-4 max-md:justify-center md:bottom-8 md:right-8"
    >
      <span className="w-2 h-2 rounded-full bg-[#050505] animate-pulse" />
      {label}
    </button>
  );
}
