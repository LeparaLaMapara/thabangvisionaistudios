'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import type { ConsentSource } from '@/lib/consent/documents';
import { TermsAcceptance, ONBOARDING_ACCEPTANCE_PURPOSES } from './TermsAcceptance';

interface OnboardingAcceptanceProps {
  firstName: string | null;
  /** 'oauth_onboarding' for Google sign-ups; 'signup' for email accounts. */
  source: Extract<ConsentSource, 'oauth_onboarding' | 'signup'>;
}

/**
 * One screen, shown once to a signed-in person who has no current acceptance
 * of the Terms and Privacy Policy on record (typically a Google sign-up, who
 * never saw the register form's checkbox, or anyone after a document
 * version changes). Records the acceptance through POST /api/consent, then
 * refreshes so the page behind it renders.
 */
export function OnboardingAcceptance({ firstName, source }: OnboardingAcceptanceProps) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!accepted || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purposes: ONBOARDING_ACCEPTANCE_PURPOSES, source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not record your acceptance. Please try again.');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-16 md:py-24">
      <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
        Welcome{firstName ? `, ${firstName}` : ''}
      </span>
      <h1 className="text-3xl md:text-4xl font-display font-medium uppercase text-white tracking-tight">
        Before you start
      </h1>
      <p className="text-sm text-neutral-400 font-mono mt-3 leading-relaxed">
        By continuing you agree to our Terms of Service and Privacy Policy. Please read them, then tick
        the box to continue.
      </p>

      <div className="mt-8 p-6 bg-[#0A0A0B] border border-white/10">
        <TermsAcceptance checked={accepted} onChange={setAccepted} disabled={submitting} />

        {error && (
          <div
            role="alert"
            className="mt-4 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono flex items-start gap-2"
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!accepted || submitting}
          className="mt-6 w-full min-h-[44px] flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Saving
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
