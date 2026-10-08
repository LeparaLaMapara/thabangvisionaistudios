'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertTriangle, Loader2, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { STUDIO } from '@/lib/constants';
import { formatDocumentDate } from '@/lib/consent/documents';

interface ConsentStepProps {
  onConsented: () => void;
}

/**
 * The identity-check notice and its own, separate consent (consent_purpose
 * 'biometric'), shown before any ID or selfie is uploaded.
 *
 * Facts stated here are taken from the code, not assumed:
 *  - files go to the private Supabase storage bucket "verifications"
 *    (app/api/verifications/route.ts);
 *  - the face comparison is an automated check by an AI service provider,
 *    currently Google's Gemini API (lib/agents/tools/vision.ts matchFaces),
 *    whose result never decides on its own: a person reviews every submission;
 *  - images are deleted STUDIO.legal.popia.retentionDays after review by the
 *    daily cron (app/api/cron/daily-maintenance, step 13), and immediately on
 *    resubmission after a rejection;
 *  - staff may view the selfie at collection to check it is you
 *    (app/api/admin/rentals/[id]/handover).
 * Where processing happens geographically, and the processor agreements, are
 * open items in docs/implementation/legal-review-checklist.md.
 *
 * Records two things: the biometric consent in consent_records (POST
 * /api/consent) and the existing POPIA acceptance on the profile (POST
 * /api/popia-consent), which the upload route still checks.
 */
export function ConsentStep({ onConsented }: ConsentStepProps) {
  const [accepted, setAccepted] = useState(false);
  const [isAdult, setIsAdult] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice = STUDIO.legal.documents.biometricNotice;
  const canSubmit = accepted && isAdult && !submitting;

  const toggleAccepted = useCallback(() => setAccepted((v) => !v), []);
  const toggleIsAdult = useCallback(() => setIsAdult((v) => !v), []);
  const toggleMarketing = useCallback(() => setMarketingOptIn((v) => !v), []);

  async function postJson(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Failed to record consent.');
    }
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await postJson('/api/consent', { purposes: ['biometric'], source: 'verification' });
      await postJson('/api/popia-consent', { accepted, isAdult, marketingOptIn });
      onConsented();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  const link = 'text-[#D4A843] hover:underline';

  return (
    <Card className="p-8">
      <div className="flex items-start gap-3 mb-6">
        <ShieldCheck className="w-6 h-6 text-[#D4A843] flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-display font-medium uppercase text-white mb-1">
            {notice.label}
          </h3>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            Please read before you upload your ID
          </p>
        </div>
      </div>

      <div className="space-y-4 mb-6 text-xs font-mono text-neutral-400 leading-relaxed">
        <p>
          <span className="text-white">Who we are.</span>{' '}
          {STUDIO.legal.companyName}, trading as {STUDIO.legal.tradingAs}
          {STUDIO.legal.registrationNumber && ` (registration ${STUDIO.legal.registrationNumber})`}.
          This notice is only about the identity check. It is separate from our Terms of Service.
        </p>

        <div>
          <p className="text-white mb-2">What we collect, and why.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>A photo of your ID document and a selfie of you holding it, to confirm you are who you say you are and to prevent fraud and gear theft.</li>
            <li>Technical detail from those photos (such as the date taken, device, and any location embedded in them), and your IP address and browser at the time, to detect tampered or reused documents.</li>
            <li>A one-way fingerprint of the ID file, so the same document cannot verify several accounts.</li>
          </ul>
        </div>

        <div>
          <p className="text-white mb-2">How the check works.</p>
          <p>
            Your photos are stored in a private storage area that is not public. An AI service
            provider we use (currently Google) makes an automated comparison of the face in your
            selfie with the face on your ID, and we keep its result: match or no match, a
            confidence score and a one-sentence reason. Then a person reviews every submission,{' '}
            {STUDIO.verification.reviewTime}. The automated comparison never approves or rejects you
            on its own. When you collect equipment, our staff may look at your selfie to check it
            is you. Our AI service provider may process the photos outside South Africa.
          </p>
        </div>

        <div>
          <p className="text-white mb-2">How long we keep it.</p>
          <p>
            The ID and selfie images are deleted automatically {STUDIO.legal.popia.retentionDays}{' '}
            days after your verification is reviewed, and straight away if you submit again after a
            rejection. The check result, the technical detail and the fingerprint are kept longer,
            for fraud prevention, as explained in our{' '}
            <Link href={notice.href} className={link}>Privacy Policy</Link>.
          </p>
        </div>

        <div>
          <p className="text-white mb-2">Withdrawing your consent.</p>
          <p>
            You can withdraw this consent at any time by emailing{' '}
            <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>{' '}
            from the address on your account. We then stop processing your ID and selfie and delete
            the images. Without a completed identity check we cannot let you hire equipment, publish
            gear or receive a payout. You can also ask to see, correct or delete your information:
            see our <Link href="/paia" className={link}>access requests page</Link>.
          </p>
        </div>

        <p className="text-neutral-500">
          Notice version {notice.version} ({formatDocumentDate(notice.version)}).
        </p>
      </div>

      <div className="space-y-3 mb-6 border-t border-white/5 pt-5">
        <CheckRow checked={accepted} onToggle={toggleAccepted} strong>
          I consent to {STUDIO.legal.tradingAs} processing my ID photo and selfie, including the
          automated face comparison described above, to verify my identity.
        </CheckRow>

        <CheckRow checked={isAdult} onToggle={toggleIsAdult} strong>
          I confirm I am 18 years of age or older.
        </CheckRow>

        <CheckRow checked={marketingOptIn} onToggle={toggleMarketing}>
          (Optional) Send me occasional updates about new features and creator opportunities. You
          can unsubscribe at any time.
        </CheckRow>
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
            I consent &amp; continue
          </>
        )}
      </Button>
    </Card>
  );
}

function CheckRow({
  checked,
  onToggle,
  strong = false,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex items-start gap-3 cursor-pointer group w-full text-left min-h-[44px] py-2"
    >
      <span className={[
        'mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center border rounded-sm transition-colors',
        checked
          ? 'bg-[#D4A843] border-[#D4A843]'
          : 'bg-neutral-900 border-white/20 group-hover:border-white/40',
      ].join(' ')}>
        {checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
      </span>
      <span className={`text-xs font-mono ${strong ? 'text-neutral-300 group-hover:text-white' : 'text-neutral-400 group-hover:text-neutral-300'} transition-colors`}>
        {children}
      </span>
    </button>
  );
}
