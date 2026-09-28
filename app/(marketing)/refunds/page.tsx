import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO, RENTAL_POLICIES } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Refunds, Returns and Cancellations',
  description:
    `How ${STUDIO.shortName} handles security deposits, returns and inspection, cancellations, refund timeframes, faulty equipment, and your rights under South African consumer law.`,
};

const LAST_UPDATED = '28 September 2026';

/** Formats a rand amount without decimals, e.g. 150 -> "R150". */
function zar(amount: number): string {
  return `${STUDIO.currency.symbol}${amount.toLocaleString(STUDIO.currency.locale)}`;
}

export default function RefundsPage() {
  const link = 'text-[#D4A843] hover:text-[#D4A843]/80 transition-colors';

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
            Legal
          </span>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight">
            Refunds, Returns &amp; Cancellations
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-6" />
        </div>

        <p className="text-sm font-mono text-neutral-400 mb-10">Last Updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Section title="1. About This Policy">
            <p>This policy forms part of our{' '}
              <Link href="/legal" className={link}>Terms of Service</Link>{' '}
              and explains what happens to your money when a hire or a booking does not run as planned.
            </p>
            <p>{STUDIO.legal.companyName} is the supplier and merchant of record for every order on this site. That means any refund due to you is paid by us, directly, and you do not need to approach anyone else for it.</p>
            <p>Nothing in this policy limits your rights under the Consumer Protection Act 68 of 2008 or the Electronic Communications and Transactions Act 25 of 2002. Where this policy gives you more than the law requires, the more generous term applies.</p>
          </Section>

          <Section title="2. Security Deposits on Equipment Hire">
            <p>Every equipment hire carries a refundable security deposit, shown on the listing and in your cart before you pay. It is a fixed amount per item, not a percentage of the hire, and it is held against late return, damage, and loss.</p>
            <p>At checkout you choose how to pay: everything online, or, when you collect, the deposit online to hold the equipment and the hire charge when you collect. Checkout shows the amounts before you pay. While online payment is not yet open, we confirm your booking once we receive your payment by EFT, cash or a card link we send you.</p>
            <p>When the equipment comes back we inspect each item and photograph its condition, then compare it against the record made when it left us. The deposit is then settled in one of four ways:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-white">Released in full</span> — everything came back on time and in the condition it went out in.</li>
              <li><span className="text-white">Released in part</span> — a deduction is made for a late return, damage, or a missing item, and the balance is refunded to you.</li>
              <li><span className="text-white">Withheld</span> — the deduction equals or exceeds the deposit.</li>
              <li><span className="text-white">Held pending a dispute</span> — where the position is not clear, or the equipment has not come back, the deposit is held while we investigate.</li>
            </ul>
            <p>Where any part of your deposit is withheld, we send you a written breakdown showing what was deducted and why. If you disagree with it, raise it with us using section 8 below.</p>
            <p>A deposit paid online is refunded to the card you paid with. A deposit paid by EFT or cash is paid back the same way. We do not refund to a third party.</p>
          </Section>

          <Section title="3. Late Returns">
            <p>Equipment is due back by the end of its return date. After that, late returns are charged at {zar(RENTAL_POLICIES.lateFeePerDayZar)} per item for each day or part of a day, for a maximum of {RENTAL_POLICIES.maxLateDays} days. The late fee for an item is recovered from that item&rsquo;s security deposit and can never exceed it.</p>
            <p>Equipment still outstanding {RENTAL_POLICIES.maxLateDays} days after the return date becomes a formal dispute. Separately from the deposit, you remain liable for the replacement cost of equipment that is never returned, and for the cost of covering another client&rsquo;s booking that your late return caused us to fail. Those amounts are invoiced to you, not taken from your card.</p>
          </Section>

          <Section title="4. Damage, Loss and Theft">
            <p>You are liable for repair costs, or for full replacement cost where an item is lost, stolen, or damaged beyond economic repair, as set out in section 13 of our{' '}
              <Link href="/legal" className={link}>Terms of Service</Link>. Fair wear and tear is excluded.
            </p>
            <p>Where the amount owed is more than your deposit, the balance is invoiced to you with the supporting documents. We do not charge additional amounts to your card without telling you first.</p>
          </Section>

          <Section title="5. Cancelling an Equipment Hire">
            <p>You can cancel an equipment booking yourself from your dashboard while it is still pending payment or confirmed. Once the equipment has been released to you, the return process applies instead and you should contact us.</p>
            <p>If you booked less than {STUDIO.legal.coolingOffDays} days ago, everything you paid online comes back: see section 10. Otherwise the refund is worked out automatically from how much notice you give, measured to the start of your first hire day, and processed to the card you paid with. You are shown the exact amount before you confirm the cancellation.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-white">More than 48 hours before the hire starts</span> — the hire charge is refunded in full.</li>
              <li><span className="text-white">Between 24 and 48 hours before</span> — 50% of the hire charge is refunded.</li>
              <li><span className="text-white">Less than 24 hours before, or after the hire has started</span> — the hire charge is not refunded, because the equipment has been held for you and turned away from other bookings.</li>
            </ul>
            <p><span className="text-white">A deposit you paid online is always refunded in full when you cancel</span>, whatever notice you give. It secures equipment against damage and late return, and on a cancellation no equipment ever left us. A deposit due at collection is simply never taken.</p>
            <p>Where you had a bulk discount, the refund is worked out on the discounted price you actually paid.</p>
            <p>Where you chose delivery, the delivery fee is refunded in full when you cancel the whole order before the equipment is sent out. If you cancel only some items, the delivery still goes ahead for the rest, so the fee stays.</p>
            <p>Where you chose to pay the deposit online and settle the hire charge on collection, cancelling before collection means there is no hire charge to refund. Your deposit comes back in full.</p>
            <p>If the automatic refund fails for any reason, your booking is still cancelled and we complete the refund by hand. We will tell you if that happens.</p>
          </Section>

          <Section title="6. Cancelling a Production or Creative Service Booking">
            <p>You can cancel a service booking up to the point where the work is delivered. After delivery, the approval process in section 7 applies instead.</p>
            <p>If you booked less than {STUDIO.legal.coolingOffDays} days ago and the shoot has not started, you get everything back: see section 10. Otherwise the refund is worked out from how much notice you give, measured to the start of your shoot day, and processed automatically to the card you paid with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-white">More than 48 hours before the shoot</span> — refunded in full.</li>
              <li><span className="text-white">Between 24 and 48 hours before</span> — 50% refunded.</li>
              <li><span className="text-white">Less than 24 hours before</span> — no refund, because crew and equipment have been committed to your date and turned away from other work.</li>
            </ul>
            <p>Where a booking was made without a fixed shoot date, we cannot measure the notice automatically, so a person assesses it. Contact{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>{' '}
              with your booking reference and we will come back to you within 2 business days.
            </p>
          </Section>

          <Section title="7. Deliverables and the 7 Day Approval Window">
            <p>When deliverables are submitted to you, you have 7 days to review them. Approve them, or tell us what is wrong. If you do not respond within 7 days, the delivery is approved automatically and the booking is treated as complete.</p>
            <p>Raise any problem inside that window. Once a booking has been approved, or auto-approved, it is settled and a refund becomes much harder to arrange.</p>
          </Section>

          <Section title="8. Faulty, Damaged or Misdescribed Supply">
            <p>Inspect equipment when you collect or receive it, and tell us immediately if an item is faulty, damaged, incomplete, or not what you booked. Do not use it. We will replace it, repair it, or refund it.</p>
            <p>If equipment or a service is not supplied as described, tell us within 7 days of receiving it. Where the fault is ours, you choose between a re-supply and a full refund. This is your right under section 56 of the Consumer Protection Act and we do not limit it.</p>
            <p>If we cancel your booking, or cannot supply what you paid for, you receive a full refund of everything you paid, with no deduction.</p>
          </Section>

          <Section title="9. Refund Timeframes">
            <ul className="list-disc pl-5 space-y-1">
              <li>We approve or decline a refund request within <span className="text-white">2 business days</span>.</li>
              <li>Approved refunds are processed within <span className="text-white">5 business days</span> of approval.</li>
              <li>Deposits are settled within <span className="text-white">5 business days</span> of the equipment being returned and passing inspection.</li>
              <li>Your bank typically takes a further <span className="text-white">5 to 10 business days</span> to reflect the money.</li>
            </ul>
            <p>Refunds are made in {STUDIO.currency.code} to the original payment method. We do not charge a fee to process a refund. If more than 15 business days have passed since we told you a refund was approved, contact us at{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>.
            </p>
          </Section>

          <Section title="10. Your 7 Day Cooling Off Right">
            <p>You may cancel any booking made on this website within {STUDIO.legal.coolingOffDays} days of making it, for any reason, and receive a full refund of everything you paid online: the hire or service charge, any delivery fee, and any deposit. This applies as long as the hire or shoot has not started.</p>
            <p>A hire starts on its first hire day, when the equipment is collected by you or delivered to you. A shoot starts on the agreed shoot day. Once that happens, you have asked us to begin supplying before the {STUDIO.legal.coolingOffDays} days ended, so the cooling off right no longer applies (section 42(2)(d) of the Electronic Communications and Transactions Act 25 of 2002), and the normal cancellation terms in sections 5 and 6 apply instead.</p>
            <p>If your hire or shoot date falls inside the {STUDIO.legal.coolingOffDays} days, you keep the full refund right until it starts. Cancel from your dashboard: you see the amount before you confirm. The Act gives us 30 days to refund you; in practice we refund within 5 business days.</p>
            <p>Outside the cooling off period, the cancellation charges in sections 5 and 6 are the reasonable charges the Consumer Protection Act (section 17) allows when a reservation is cancelled, because the gear or the creator was held for you and turned away from others.</p>
          </Section>

          <Section title="11. Complaints and Escalation">
            <p>If you are unhappy with a refund decision, tell us. Email{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>{' '}
              with your booking reference, or call {STUDIO.phone} during business hours.
            </p>
            <p>We acknowledge every complaint within 2 business days and aim to resolve it within 10 business days. If we need longer, we tell you why and give you a revised date.</p>
            <p>If you are still not satisfied, escalate in writing to{' '}
              <a href={`mailto:${STUDIO.email}`} className={link}>{STUDIO.email}</a>{' '}
              for review by management. You keep the right to refer an unresolved complaint to the National Consumer Commission or to a court of competent jurisdiction in South Africa.
            </p>
          </Section>

          <Section title="12. Chargebacks">
            <p>If you do not recognise a charge from {STUDIO.shortName}, contact us before raising a dispute with your bank. Most queries are resolved the same day, and a chargeback takes considerably longer than a refund.</p>
            <p>Where a chargeback is raised, we supply your bank and our payment provider with the booking record, the collection or delivery confirmation, the return and inspection record, and the related correspondence. Chargebacks raised in bad faith, where the equipment or service was supplied as agreed, may be recovered from you as a debt.</p>
          </Section>

          <Section title="13. Contact">
            <p>
              {STUDIO.legal.companyName}<br />
              {STUDIO.legal.registeredAddress && (<>{STUDIO.legal.registeredAddress}<br /></>)}
              Registration number {STUDIO.legal.registrationNumber}<br />
              Refunds and returns{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>
              <br />
              Telephone {STUDIO.phone}<br />
              {STUDIO.hours.weekday} | {STUDIO.hours.weekend} | {STUDIO.hours.sunday}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
