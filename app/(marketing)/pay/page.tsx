import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';
import { BankDetails } from '@/components/payments/BankDetails';
import { ContactButtons } from '@/components/payments/ContactButtons';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildPageMetadata({
  title: 'How to pay',
  description: `Pay ${STUDIO.shortName} by EFT to our business account, or in cash when you collect at ${STUDIO.fulfilment.dispatchFrom.meetingPoint}, ${STUDIO.fulfilment.dispatchFrom.name}.`,
  path: '/pay',
});

/**
 * How paying works, and the one place a customer can always check the real
 * bank details (the defence against fake "new bank details" messages).
 */
export default function PayPage() {
  const where = `${STUDIO.fulfilment.dispatchFrom.meetingPoint}, ${STUDIO.fulfilment.dispatchFrom.name}`;
  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-2xl space-y-12">
        <header>
          <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">Payments</span>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight">How to pay</h1>
          <p className="mt-6 text-lg text-neutral-300 leading-relaxed">
            Pay by EFT to our business account, or in cash when you collect. You see the full amount before you book.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Pay by EFT</h2>
          <ol className="list-decimal pl-5 space-y-2 text-neutral-300 leading-relaxed">
            <li>Book your gear. Your booking page and email show the amount and your reference, for example TV-3F9A2C.</li>
            <li>Pay the amount into the account below within {STUDIO.bank.payWithinHours} hours, with your reference.</li>
            <li>Send us your proof of payment on WhatsApp or to {STUDIO.bookingEmail}.</li>
            <li>We confirm your booking as soon as the payment shows, and send you the collection details.</li>
          </ol>
          <BankDetails />
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Pay in cash when you collect</h2>
          <p className="text-neutral-300 leading-relaxed">
            Choose cash at checkout, then bring the amount and your ID card to {where} on your first hire day. Cash is for collection only, not delivery.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Refunds</h2>
          <p className="text-neutral-300 leading-relaxed">
            Deposits and refunds go back by EFT to your account, or in cash if you paid in cash. See our{' '}
            <Link href="/refunds" className="underline underline-offset-4">refunds policy</Link>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Questions</h2>
          <p className="text-neutral-300 leading-relaxed">WhatsApp us. A person answers during business hours ({STUDIO.hours.weekday}, {STUDIO.hours.weekend}).</p>
          <ContactButtons message="Hi, I have a question about paying for a booking" />
        </section>
      </div>
    </div>
  );
}
