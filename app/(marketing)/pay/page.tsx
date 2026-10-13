// Re-rendered every minute: the wording follows whether online payment is
// open (onlinePaymentsOpen), which is configuration, not a constant.
export const revalidate = 60;

import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';
import { BankDetails } from '@/components/payments/BankDetails';
import { ContactButtons } from '@/components/payments/ContactButtons';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { paymentsOpenForLegalPages } from '@/lib/consent/legal-facts';

export const metadata: Metadata = buildPageMetadata({
  title: 'How to pay',
  description: `How paying ${STUDIO.shortName} works, and the one place to check our real bank details.`,
  path: '/pay',
});

/**
 * How paying works, and the one place a customer can always check the real
 * bank details (the defence against fake "new bank details" messages).
 */
export default function PayPage() {
  const where = `${STUDIO.fulfilment.dispatchFrom.meetingPoint}, ${STUDIO.fulfilment.dispatchFrom.name}`;
  // With card payment open, checkout takes card only (app/api/cart/checkout),
  // so EFT and cash are not offered as checkout choices here.
  if (paymentsOpenForLegalPages()) return <CardPayPage />;
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

/** How paying works while online card payment is open. */
function CardPayPage() {
  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-2xl space-y-12">
        <header>
          <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">Payments</span>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight">How to pay</h1>
          <p className="mt-6 text-lg text-neutral-300 leading-relaxed">
            You pay by card when you book, on our payment provider&rsquo;s secure page. You see the full amount before you pay.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Pay by card</h2>
          <ol className="list-decimal pl-5 space-y-2 text-neutral-300 leading-relaxed">
            <li>Choose your gear or creator and your dates.</li>
            <li>At checkout you pay the whole amount by card. For gear this is the hire and the refundable deposit together.</li>
            <li>You come straight back to your bookings page, and we email you the confirmation.</li>
          </ol>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Our bank details</h2>
          <p className="text-neutral-300 leading-relaxed">
            Bookings on this site are paid by card, not by EFT. These are the only bank details we ever use, so you can check any message that claims to come from us. If anyone sends you &ldquo;new&rdquo; bank details, do not pay: WhatsApp us first.
          </p>
          <BankDetails />
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">Refunds</h2>
          <p className="text-neutral-300 leading-relaxed">
            Refunds and deposits go back to the card you paid with. See our{' '}
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
