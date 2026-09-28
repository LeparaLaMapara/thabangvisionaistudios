'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertTriangle, Loader2, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { STUDIO } from '@/lib/constants';

interface ConsentStepProps {
  onConsented: () => void;
}

export function ConsentStep({ onConsented }: ConsentStepProps) {
  const [accepted, setAccepted] = useState(false);
  const [isAdult, setIsAdult] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = accepted && isAdult && !submitting;

  const toggleAccepted = useCallback(() => setAccepted((v) => !v), []);
  const toggleIsAdult = useCallback(() => setIsAdult((v) => !v), []);
  const toggleMarketing = useCallback(() => setMarketingOptIn((v) => !v), []);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/popia-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted, isAdult, marketingOptIn }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to record consent.');
      }
      onConsented();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-8">
      <div className="flex items-start gap-3 mb-6">
        <ShieldCheck className="w-6 h-6 text-[#D4A843] flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-display font-medium uppercase text-white mb-1">
            Privacy Notice — POPIA Consent
          </h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
            Required before we can process your ID documents
          </p>
        </div>
      </div>

      <div className="space-y-4 mb-6 text-xs font-mono text-neutral-400 leading-relaxed">
        <p>
          <span className="text-white">Who we are.</span>{' '}
          {STUDIO.legal.companyName}, trading as {STUDIO.legal.tradingAs}
          {STUDIO.legal.registrationNumber && ` (registration ${STUDIO.legal.registrationNumber})`}.
        </p>

        <div>
          <p className="text-white mb-2">What we collect and why.</p>
          <ul className="list-disc pl-5 space-y-1 text-neutral-400">
            <li>SA ID photos &amp; selfie — to verify your identity and prevent fraud.</li>
            <li>EXIF metadata from uploads — to detect duplicate or tampered documents.</li>
            <li>IP address &amp; device info — security audit trail and abuse prevention.</li>
            <li>Consent evidence — timestamp, version, and IP of this acceptance.</li>
          </ul>
        </div>

        <div>
          <p className="text-white mb-2">How long we keep it.</p>
          <p className="text-neutral-400">
            ID documents are automatically deleted {STUDIO.legal.popia.retentionDays} days
            after verification review. Consent records and verification status are retained
            for the life of your account plus 5 years for tax and legal audit.
          </p>
        </div>

        <div>
          <p className="text-white mb-2">Your rights.</p>
          <p className="text-neutral-400">
            You may request access, correction, or deletion of your personal information
            at any time by emailing{' '}
            <a
              href={`mailto:${STUDIO.privacyEmail}`}
              className="text-[#D4A843] hover:underline"
            >
              {STUDIO.privacyEmail}
            </a>
            . You may also withdraw consent by deleting your account.
          </p>
        </div>

        <p>
          <span className="text-white">Recipients.</span> We share limited data only with
          Supabase (storage &amp; auth), Paystack (payouts), and Cloudinary (image CDN) —
          all under written processing agreements. We never sell your data.
        </p>

        <p className="text-neutral-400">
          Read the full notice:{' '}
          <Link href="/privacy" className="text-[#D4A843] hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      <div className="space-y-3 mb-6 border-t border-white/5 pt-5">
        <button
          type="button"
          onClick={toggleAccepted}
          className="flex items-start gap-3 cursor-pointer group w-full text-left min-h-[44px] py-2"
        >
          <span className={[
            'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center border rounded-sm transition-colors',
            accepted
              ? 'bg-[#D4A843] border-[#D4A843]'
              : 'bg-neutral-900 border-white/20 group-hover:border-white/40',
          ].join(' ')}>
            {accepted && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
          </span>
          <span className="text-xs font-mono text-neutral-300 group-hover:text-white transition-colors">
            I have read and understood the privacy notice, and I consent to
            {' '}{STUDIO.legal.tradingAs}{' '}processing my personal information as described.
          </span>
        </button>

        <button
          type="button"
          onClick={toggleIsAdult}
          className="flex items-start gap-3 cursor-pointer group w-full text-left min-h-[44px] py-2"
        >
          <span className={[
            'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center border rounded-sm transition-colors',
            isAdult
              ? 'bg-[#D4A843] border-[#D4A843]'
              : 'bg-neutral-900 border-white/20 group-hover:border-white/40',
          ].join(' ')}>
            {isAdult && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
          </span>
          <span className="text-xs font-mono text-neutral-300 group-hover:text-white transition-colors">
            I confirm I am 18 years of age or older.
          </span>
        </button>

        <button
          type="button"
          onClick={toggleMarketing}
          className="flex items-start gap-3 cursor-pointer group w-full text-left min-h-[44px] py-2"
        >
          <span className={[
            'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center border rounded-sm transition-colors',
            marketingOptIn
              ? 'bg-[#D4A843] border-[#D4A843]'
              : 'bg-neutral-900 border-white/20 group-hover:border-white/40',
          ].join(' ')}>
            {marketingOptIn && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
          </span>
          <span className="text-xs font-mono text-neutral-400 group-hover:text-neutral-300 transition-colors">
            <span className="text-neutral-400">(Optional)</span> Send me occasional updates
            about new features, creator opportunities, and SA industry insights. You can
            unsubscribe at any time.
          </span>
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <Button onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Recording consent...
          </>
        ) : (
          <>
            <ShieldCheck className="w-3.5 h-3.5" />
            Accept &amp; Continue
          </>
        )}
      </Button>
    </Card>
  );
}
