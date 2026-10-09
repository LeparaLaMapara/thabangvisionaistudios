import { STUDIO } from '@/lib/constants';

/**
 * The plain disclosure on the sign-in screen. It is not itself a record of
 * consent: that is taken once, with an explicit tap, on /welcome
 * (POST /api/consent), for anyone whose acceptance of the current versions
 * is not on record.
 */
export function TermsNotice({ className = '' }: { className?: string }) {
  const docs = STUDIO.legal.documents;
  const link =
    // Inline padding widens the tap target to 44px without spreading the lines apart.
    'py-4 text-white underline underline-offset-2 hover:text-[#D4A843] transition-colors';
  return (
    <p className={`text-xs font-mono text-neutral-400 leading-relaxed ${className}`} data-testid="terms-notice">
      By continuing you agree to our{' '}
      <a href={docs.terms.href} target="_blank" rel="noopener noreferrer" className={link}>
        {docs.terms.label}
      </a>{' '}
      and{' '}
      <a href={docs.privacy.href} target="_blank" rel="noopener noreferrer" className={link}>
        {docs.privacy.label}
      </a>
      .
    </p>
  );
}
