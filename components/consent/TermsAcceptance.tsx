'use client';

import { useId } from 'react';
import { STUDIO } from '@/lib/constants';
import type { ConsentPurpose } from '@/lib/consent/documents';

/** What ticking the box at checkout records (see requiredConsents('checkout')). */
export const CHECKOUT_ACCEPTANCE_PURPOSES: readonly ConsentPurpose[] = ['terms', 'privacy', 'rental_agreement'];
/** What ticking the box at first sign-in records. */
export const ONBOARDING_ACCEPTANCE_PURPOSES: readonly ConsentPurpose[] = ['terms', 'privacy'];

interface TermsAcceptanceProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Also name the rental agreement (equipment checkout). */
  includeRentalAgreement?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A required, unticked-by-default acceptance checkbox for the Terms of
 * Service and Privacy Policy (and, at checkout, the rental agreement). The
 * links open in a new tab so the person does not lose their cart.
 *
 * This only collects the tick. The server must record it (POST /api/consent,
 * or recordConsent() inside the checkout route) and refuse to proceed
 * without it: a client-side checkbox alone is not evidence.
 */
export function TermsAcceptance({
  checked,
  onChange,
  includeRentalAgreement = false,
  disabled = false,
  className = '',
}: TermsAcceptanceProps) {
  const id = useId();
  const docs = STUDIO.legal.documents;
  const link = 'text-[#D4A843] underline underline-offset-2 hover:text-[#D4A843]/80';

  return (
    <div className={`flex items-start gap-3 min-h-[44px] py-2 ${className}`}>
      <input
        id={id}
        type="checkbox"
        required
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-[#D4A843] bg-neutral-900 border border-white/20 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="text-xs font-mono text-neutral-300 leading-relaxed cursor-pointer">
        I agree to the{' '}
        <a href={docs.terms.href} target="_blank" rel="noopener noreferrer" className={link}>
          {docs.terms.label}
        </a>
        {includeRentalAgreement ? ', the ' : ' and the '}
        <a href={docs.privacy.href} target="_blank" rel="noopener noreferrer" className={link}>
          {docs.privacy.label}
        </a>
        {includeRentalAgreement && (
          <>
            {' '}and the{' '}
            <a href={docs.rentalAgreement.href} target="_blank" rel="noopener noreferrer" className={link}>
              {docs.rentalAgreement.label.toLowerCase()}
            </a>{' '}
            for this hire
          </>
        )}
        .
      </label>
    </div>
  );
}
