/**
 * What makes a creator bookable, as a checklist the creator can see up
 * front. Pure. It mirrors the rules that actually decide it, it does not
 * add new ones:
 *   - booking a named creator needs a verified ID, "available for hire" on
 *     and an account that is not suspended (lib/bookings/creator.ts);
 *   - the public creator directory also needs a complete portfolio, at
 *     least one project with 3 photos (lib/portfolio/validation.ts);
 *   - the profile page lets a creator switch "available for hire" on only
 *     with a payout account saved and a complete portfolio.
 */

export type BookableStep = 'id_verified' | 'portfolio_complete' | 'payout_account' | 'available_for_hire';

export interface BookableItem {
  step: BookableStep;
  done: boolean;
  label: string;
  detail: string;
  href: string;
}

export interface BookableFacts {
  verificationStatus: string | null;
  portfolioComplete: boolean;
  hasPayoutAccount: boolean;
  availableForHire: boolean;
}

export function creatorBookableChecklist(f: BookableFacts): BookableItem[] {
  const verified = f.verificationStatus === 'verified';
  return [
    {
      step: 'id_verified',
      done: verified,
      label: 'ID check passed',
      detail:
        f.verificationStatus === 'pending'
          ? 'A person is checking it now.'
          : 'A photo of your ID and a selfie, checked once by a person.',
      href: '/dashboard/verification',
    },
    {
      step: 'portfolio_complete',
      done: f.portfolioComplete,
      label: 'Portfolio with at least one project of 3 photos',
      detail: 'You can build it now. Nobody sees it until your ID check passes and you are available for hire.',
      href: '/dashboard/portfolio',
    },
    {
      step: 'payout_account',
      done: f.hasPayoutAccount,
      label: 'Payout bank account added',
      detail: 'Where your earnings are paid. The account holder must match the name on your ID.',
      href: '/dashboard/banking',
    },
    {
      step: 'available_for_hire',
      done: f.availableForHire && verified,
      label: 'Available for hire switched on',
      detail: verified
        ? 'In Creator settings on your profile.'
        : 'You can switch it on in your profile once your ID check has passed.',
      href: '/dashboard/profile',
    },
  ];
}

/** True when clients can find and book this creator. */
export function isCreatorBookable(f: BookableFacts): boolean {
  return creatorBookableChecklist(f).every((i) => i.done);
}
