import Link from 'next/link';
import { CheckCircle2, Clock, PencilLine, ShieldCheck } from 'lucide-react';
import { EARN } from '@/lib/constants';
import { earningsLine, PERSON_PAYOUT_LINE, type OfferStatusView, type PricingUnit } from '@/lib/roles';

/**
 * What someone who already sent their profile sees on /offer, instead of an
 * empty form: where it is (with our team, live, or sent back with the
 * reviewer's note), the ID check, and what they earn and when they are paid.
 */
export function OfferStatus({
  view,
  price,
  editHref,
  newHref,
}: {
  view: OfferStatusView;
  price: { unit: PricingUnit; cents: number } | null;
  /** Opens the form again (sent back: make the change). */
  editHref: string;
  /** Offer something else. */
  newHref: string;
}) {
  const Icon = view.kind === 'live' ? CheckCircle2 : view.kind === 'sent_back' ? PencilLine : Clock;
  const big = 'w-full min-h-[56px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2';
  const ghost = 'w-full min-h-[52px] px-4 border border-white/20 text-neutral-200 text-sm flex items-center justify-center gap-2 hover:border-accent-gold';

  return (
    <div className="max-w-lg mx-auto px-4 pt-24 pb-16">
      <p className="text-xs font-mono uppercase tracking-widest text-accent-gold mb-6">{EARN.label}</p>
      <section aria-live="polite">
        <Icon className="w-12 h-12 text-accent-gold mb-4" aria-hidden="true" />
        <h1 className="text-3xl font-display font-medium text-white mb-3">{view.title}</h1>
        {view.lines.map((l) => (
          <p key={l} className="text-neutral-300 mb-2">{l}</p>
        ))}
        {view.note && (
          <blockquote className="mt-4 border-l-2 border-accent-gold pl-4 text-white whitespace-pre-line" data-testid="reviewer-note">
            {view.note}
          </blockquote>
        )}
      </section>

      <div className="mt-6 border border-white/10 p-4">
        <p className="flex items-start gap-2 text-sm text-neutral-200">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-accent-gold" aria-hidden="true" /> {view.idCheck.text}
        </p>
        {view.idCheck.action && (
          <Link href={view.idCheck.action.href} className={`${big} mt-4`}>{view.idCheck.action.label}</Link>
        )}
      </div>

      <div className="mt-4 border border-white/10 p-4 space-y-2 text-sm text-neutral-300">
        <p className="text-white">Your money</p>
        {price && <p>{earningsLine(price.unit, price.cents)}</p>}
        <p>{PERSON_PAYOUT_LINE}</p>
      </div>

      <div className="mt-8 space-y-3">
        {view.kind === 'sent_back' && <Link href={editHref} className={big}>Make the change</Link>}
        {view.primary && <Link href={view.primary.href} className={big}>{view.primary.label}</Link>}
        <Link href="/dashboard" className={ghost}>Go to my dashboard</Link>
        <Link href={newHref} className="block text-center min-h-[44px] pt-3 text-sm text-neutral-400 underline underline-offset-4">Offer something else</Link>
      </div>
    </div>
  );
}
