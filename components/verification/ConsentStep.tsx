'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
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
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
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
          <ul className="list-disc pl-5 space-y-1 text-neutral-500">
            <li>SA ID photos &amp; selfie — to verify your identity and prevent fraud.</li>
            <li>EXIF metadata from uploads — to detect duplicate or tampered documents.</li>
            <li>IP address &amp; device info — security audit trail and abuse prevention.</li>
            <li>Consent evidence — timestamp, version, and IP of this acceptance.</li>
          </ul>
        </div>

        <div>
          <p className="text-white mb-2">How long we keep it.</p>
          <p className="text-neutral-500">
            ID documents are automatically deleted {STUDIO.legal.popia.retentionDays} days
            after verification review. Consent records and verification status are retained
            for the life of your account plus 5 years for tax and legal audit.
          </p>
        </div>

        <div>
          <p className="text-white mb-2">Your rights.</p>
          <p className="text-neutral-500">
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

        <p className="text-neutral-600">
          Read the full notice:{' '}
          <Link href="/privacy" className="text-[#D4A843] hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      <div className="space-y-3 mb-6 border-t border-white/5 pt-5">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-neutral-900 border border-white/20 accent-[#D4A843]"
          />
          <span className="text-xs font-mono text-neutral-300 group-hover:text-white transition-colors">
            I have read and understood the privacy notice, and I consent to
            {' '}{STUDIO.legal.tradingAs}{' '}processing my personal information as described.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={isAdult}
            onChange={(e) => setIsAdult(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-neutral-900 border border-white/20 accent-[#D4A843]"
          />
          <span className="text-xs font-mono text-neutral-300 group-hover:text-white transition-colors">
            I confirm I am 18 years of age or older.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-neutral-900 border border-white/20 accent-[#D4A843]"
          />
          <span className="text-xs font-mono text-neutral-500 group-hover:text-neutral-300 transition-colors">
            <span className="text-neutral-400">(Optional)</span> Send me occasional updates
            about new features, creator opportunities, and SA industry insights. You can
            unsubscribe at any time.
          </span>
        </label>
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
