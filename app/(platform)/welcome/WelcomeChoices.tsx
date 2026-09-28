'use client';

import { useState } from 'react';
import { Camera, Users, Briefcase, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { WELCOME_CHOICES, type WelcomeIntent, type SavedIntent } from '@/lib/welcome';

const ICONS: Record<WelcomeIntent, typeof Camera> = {
  rent: Camera,
  hire: Users,
  supply: Briefcase,
};

export default function WelcomeChoices({ firstName }: { firstName: string | null }) {
  const [busy, setBusy] = useState<SavedIntent | null>(null);

  const choose = async (intent: SavedIntent, href: string) => {
    setBusy(intent);
    // Remember the answer on the account, so the dashboard, Ubunye and the
    // owner's welcome message can use it. If saving fails, still go: the
    // person matters more than the record.
    try {
      await createClient().auth.updateUser({ data: { intent, intent_at: new Date().toISOString() } });
    } catch {
      /* not worth stopping them for */
    }
    window.location.assign(href);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 md:py-24">
      <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
        Welcome{firstName ? `, ${firstName}` : ''}
      </span>
      <h1 className="text-3xl md:text-4xl font-display font-medium uppercase text-white tracking-tight">
        What did you come to do?
      </h1>
      <p className="text-sm text-neutral-400 font-mono mt-3">
        Pick one. You can do the others any time.
      </p>

      <div className="mt-10 space-y-4">
        {WELCOME_CHOICES.map((c) => {
          const Icon = ICONS[c.intent];
          return (
            <button
              key={c.intent}
              type="button"
              onClick={() => choose(c.intent, c.href)}
              disabled={busy !== null}
              className="w-full min-h-[44px] text-left flex items-center gap-5 p-6 bg-[#0A0A0B] border border-white/10 hover:border-[#D4A843]/60 transition-colors disabled:opacity-60"
            >
              <Icon className="w-8 h-8 text-[#D4A843] flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-lg font-display font-medium uppercase text-white">{c.title}</span>
                <span className="block text-xs font-mono text-neutral-400 mt-1 leading-relaxed">{c.detail}</span>
              </span>
              <ArrowRight className="w-5 h-5 text-neutral-400" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => choose('browse', '/')}
        disabled={busy !== null}
        className="inline-block min-h-[44px] mt-8 text-xs font-mono text-neutral-400 underline underline-offset-2 hover:text-white"
      >
        I&apos;m just looking around
      </button>
    </div>
  );
}
