'use client';

import Link from 'next/link';
import { Mail } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { BankDetails } from '@/components/payments/BankDetails';
import { ContactButtons } from '@/components/payments/ContactButtons';

export interface PaymentInfo {
  method: string;
  reference: string;
  amountDue: number;
}

const rand = (n: number): string => `R${n.toLocaleString(STUDIO.currency.locale)}`;

/**
 * What to do next on a booking that waits for payment: the amount, the
 * reference and the bank details for an EFT (with proof by WhatsApp or email),
 * or, for cash, what to bring to the collection point.
 */
export function PayPanel({ info, startDate }: { info: PaymentInfo; startDate?: string }) {
  const where = `${STUDIO.fulfilment.dispatchFrom.meetingPoint}, ${STUDIO.fulfilment.dispatchFrom.name}`;
  if (info.method === 'cash') {
    return (
      <section aria-label="How to pay" className="border border-[#D4A843]/30 bg-[#D4A843]/5 p-5 mb-6 space-y-3">
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white">Pay in cash when you collect</h2>
        <p className="text-sm text-neutral-300 leading-relaxed">
          Bring {rand(info.amountDue)} in cash and your ID card to {where}
          {startDate ? ` on ${startDate}` : ''}. Your reference is <span className="font-mono text-[#D4A843]">{info.reference}</span>.
        </p>
        <ContactButtons message={`Hi, a question about my booking ${info.reference}`} />
      </section>
    );
  }
  const proofSubject = encodeURIComponent(`Proof of payment ${info.reference}`);
  return (
    <section aria-label="How to pay" className="border border-[#D4A843]/30 bg-[#D4A843]/5 p-5 mb-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white">
          Pay {rand(info.amountDue)} by EFT to confirm
        </h2>
        <p className="text-sm text-neutral-300 leading-relaxed">
          Your dates are held for {STUDIO.bank.payWithinHours} hours. Use the reference exactly as shown, then send us your proof of payment.
        </p>
      </div>
      <BankDetails reference={info.reference} amount={rand(info.amountDue)} />
      <div className="space-y-2">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Send proof of payment</p>
        <ContactButtons message={`Hi, here is my proof of payment for booking ${info.reference}`} />
        <a
          href={`mailto:${STUDIO.bookingEmail}?subject=${proofSubject}`}
          className="min-h-[44px] inline-flex items-center gap-2 text-sm text-neutral-300 underline underline-offset-4"
        >
          <Mail className="w-4 h-4" aria-hidden="true" /> Or email it to {STUDIO.bookingEmail}
        </a>
      </div>
      <p className="text-xs text-neutral-400">
        We confirm as soon as the payment shows, and you get a message with collection details. <Link href="/pay" className="underline underline-offset-4">How paying works</Link>
      </p>
    </section>
  );
}
