import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO, RENTAL_POLICIES } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    `${STUDIO.shortName} Terms of Service — who you contract with, equipment hire, deposits, damage and loss, production services, payment, cancellations, and dispute resolution.`,
};

const LAST_UPDATED = 'August 2026';

/** Formats a rand amount without decimals, e.g. 150 -> "R150". */
function zar(amount: number): string {
  return `${STUDIO.currency.symbol}${amount.toLocaleString(STUDIO.currency.locale)}`;
}

export default function LegalPage() {
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
            Terms of Service
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-6" />
        </div>

        <p className="text-sm font-mono text-neutral-500 mb-10">Last Updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Part title="Part A — General" />

          <Section title="1. Acceptance of Terms">
            <p>By accessing or using the {STUDIO.shortName} website and services, including equipment hire, production services, and our online booking tools, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>
            <p>These terms are read together with our{' '}
              <Link href="/privacy" className={link}>Privacy Policy</Link>{' '}and our{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations Policy</Link>, which forms part of this agreement.
            </p>
          </Section>

          <Section title="2. Who You Are Contracting With">
            <p>This website and all services offered on it are operated by {STUDIO.legal.companyName}, a private company registered in the Republic of South Africa under registration number {STUDIO.legal.registrationNumber}.</p>
            {STUDIO.legal.registeredAddress && (
              <p>Registered business address: {STUDIO.legal.registeredAddress}</p>
            )}
            <p>{STUDIO.legal.companyName} is the supplier and merchant of record for every order placed and paid for on this website. When you pay on this site, your contract is with {STUDIO.legal.companyName}. We are responsible to you for supplying the equipment or service you paid for, and for any refund due to you under these terms.</p>
            <p>Where equipment or a service is sourced from a verified creator or partner in our supplier network, that creator or partner is engaged by us as our supplier. They are not a party to your contract, you do not pay them, and any claim arising from your order is made against {STUDIO.legal.companyName}.</p>
          </Section>

          <Section title="3. Account Registration">
            <p>To access certain features of the platform you must create an account. You are responsible for keeping your account credentials confidential and for all activity that occurs under your account. You must provide accurate and complete information during registration.</p>
          </Section>

          <Section title="4. Identity Verification">
            <p>Certain platform features require identity verification. By submitting verification documents you confirm that you are the person depicted in those documents and that all information provided is accurate. Fraudulent submissions result in permanent account suspension.</p>
            <p>Verification documents are handled in accordance with our{' '}
              <Link href="/privacy" className={link}>Privacy Policy</Link>. Please read it before submitting: it explains where your documents are stored, that automated checks are performed on them, and how long they are kept.
            </p>
          </Section>

          <Section title="5. Services and Equipment">
            <p>{STUDIO.shortName} supplies professional production services and professional equipment on hire, including cameras and optics, lighting and power, grip and motion, audio, aerial support, and sound reinforcement, together with related crew and production services.</p>
            <p>Every listing shown on the platform, whether from our own fleet or contributed by a verified creator in our supplier network, is supplied to you by {STUDIO.legal.companyName} on the basis set out in section 2. Prices, availability, and specifications shown on the site are confirmed at the time of booking.</p>
          </Section>

          <Section title="6. Pricing and Payment">
            <p>All prices are quoted in South African Rand ({STUDIO.currency.code}).</p>
            {STUDIO.legal.vatRegistered ? (
              <p>{STUDIO.legal.companyName} is a registered VAT vendor{STUDIO.legal.vatNumber ? ` under VAT registration number ${STUDIO.legal.vatNumber}` : ''}. Equipment hire prices shown on this site include VAT at {STUDIO.booking.vatRate}%, and the VAT portion is itemised in your cart and on your invoice. Production and creative service rates are shown excluding VAT; VAT at {STUDIO.booking.vatRate}% is added at checkout and shown as a separate line on your quote and invoice. Refundable security deposits are not subject to VAT. Our VAT registration number appears on every tax invoice we issue.</p>
            ) : (
              <p>Where VAT becomes applicable it is shown separately at checkout and on your invoice.</p>
            )}
            <p>Card payments are processed by our authorised payment gateway, a registered South African payment service provider, over secure encrypted connections. We accept South African debit and credit cards together with the other payment methods presented at checkout. {STUDIO.shortName} does not store your full card details on our servers.</p>
            <p>Payment is collected by {STUDIO.legal.companyName} as principal. Funds are not held in escrow or in trust for any third party, and no part of your payment is disbursed to a third party on your behalf.</p>
            <p>A booking is confirmed only once payment or the required deposit has been received and we have sent you a written confirmation.</p>
          </Section>

          <Part title="Part B — Equipment Hire" />

          <Section title="7. Eligibility to Hire">
            <p>Equipment may only be hired by an account that has completed identity verification. Our checkout will not accept an equipment order from an unverified account. You must be 18 years or older.</p>
            <p>The verified account holder is the hirer and is responsible for the equipment for the entire hire period. Where you hire on behalf of a production, agency, or end client, or act as a facilitator or fixer, you remain the hirer and remain liable for payment and for the equipment, whether or not your own client settles with you.</p>
            <p>Equipment must be booked at least {STUDIO.rental.minLeadTimeHours} hours before the hire begins, so that it can be checked, charged and prepared for you. Because hires are booked by the day, this is measured to the start of your first hire day, which means the earliest date you can select is usually two to three days ahead depending on when you book. Shorter notice may be possible by arrangement, but cannot be booked online.</p>
            <p>A single cart hire may run for up to {STUDIO.rental.maxBookingDays} days and contain up to {STUDIO.rental.maxCartItems} items. Longer hires are arranged directly with us. Equipment already booked for your dates cannot be double-booked, and our checkout will tell you if a conflict exists.</p>
          </Section>

          <Section title="8. Ownership and Permitted Use">
            <p>All hired equipment remains the property of {STUDIO.legal.companyName} at all times. Hiring gives you possession and use for the agreed period, and nothing more.</p>
            <p>You undertake to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>use each item only for its intended purpose and for the production the hire was booked for;</li>
              <li>allow only adequately qualified personnel to operate the equipment;</li>
              <li>not sub-hire, lend, sell, pledge, or part with possession of the equipment to anyone else;</li>
              <li>not alter, modify, service, or attempt to repair any item, including where a fault develops;</li>
              <li>keep the equipment under your control and supervision at all times;</li>
              <li>not take the equipment outside South Africa without our prior written consent;</li>
              <li>allow us access to inspect or recover the equipment on reasonable request.</li>
            </ul>
            <p>If a fault develops during the hire, stop using the item and contact us at{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>{' '}
              so that we can arrange a replacement or a repair.
            </p>
          </Section>

          <Section title="9. Risk">
            <p>Risk in the equipment passes to you when the equipment is handed over to you or to a person acting on your behalf. From that moment until the equipment is returned and inspected, you are responsible for loss, theft, and damage however it arises, other than fair wear and tear.</p>
            <p>Risk returns to {STUDIO.shortName} only once the equipment has been physically returned and individually checked and inspected by us. Returning equipment does not by itself end your responsibility for it.</p>
          </Section>

          <Section title="10. Security Deposit">
            <p>A refundable security deposit is payable on every equipment hire. The deposit is a fixed amount shown on each listing and in your cart before you pay. It is not a percentage of the hire value, and it is not part payment of the hire.</p>
            <p>After the equipment is returned and inspected, the deposit is released in full, released in part, or withheld, depending on the condition the equipment comes back in and whether it was returned on time. Any amount released is refunded to the original payment method used for the order. Where any part of the deposit is withheld, we give you a written breakdown of the deduction.</p>
            <p>Full detail on timing and process is in our{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations Policy</Link>.
            </p>
          </Section>

          <Section title="11. Collection and Return">
            <p>You choose collection or delivery at checkout.</p>
            <p><span className="text-white">Collection.</span> Collect from our {STUDIO.location.city} studio during business hours. You may pay in full online, or pay the security deposit online to hold the equipment and settle the hire charge when you collect. The person collecting must be the verified account holder, or someone you have nominated to us in writing beforehand.</p>
            <p><span className="text-white">Delivery.</span> We deliver in our own vehicle within {STUDIO.fulfilment.delivery.maxRadiusKm}km of our studio. The delivery fee is calculated from the road distance to your address and the size of your order, and the exact amount is shown to you at checkout before you pay. Beyond that radius, contact us for a quote. Delivery is charged in full at checkout and is not refundable once the vehicle has been dispatched.</p>
            <p>We operate from {STUDIO.locations.map((l) => l.city).join(' and ')}, {STUDIO.location.province}. Our business hours are {STUDIO.hours.weekday}, {STUDIO.hours.weekend}, {STUDIO.hours.sunday}. Collections, deliveries and returns outside these hours are by prior arrangement only, and a fee may apply.</p>
            <p>Each item is inspected and its condition recorded with photographs both when it leaves us and when it comes back. That pair of records is what your deposit is assessed against. You are welcome to be present at either inspection, and to ask us for a copy of both records.</p>
          </Section>

          <Section title="12. Late Return and Overdue Equipment">
            <p>Equipment must be returned by the return date in your booking confirmation. Late returns are charged a late fee of {zar(RENTAL_POLICIES.lateFeePerDayZar)} per day or part of a day, up to a maximum of {RENTAL_POLICIES.maxLateDays} days. The late fee is recovered from your security deposit and is capped at the amount of that deposit.</p>
            <p>Where a late return causes us to fail a booking already made by another client, you are additionally liable for the cost of sourcing replacement equipment to cover that booking.</p>
            <p>Equipment not returned by the return date is marked overdue and you will be notified. Equipment still outstanding {RENTAL_POLICIES.maxLateDays} days after the return date is treated as a formal dispute and may be reported to the South African Police Service as stolen.</p>
            <p>Accounts with three or more open disputes are suspended, and any listings supplied by that account are removed from sale while the disputes are resolved.</p>
          </Section>

          <Section title="13. Damage, Loss and Theft">
            <p>You must return the equipment in the same condition it was hired in, fair wear and tear excepted. You are liable for the cost of repair, or for the full replacement cost where an item is lost, stolen, or damaged beyond economic repair.</p>
            <p>This includes missing accessories and cables, tears, scratches, cuts, burns, marks that cannot be removed, chipped or damaged glass and optics, and damage to housings and casings. Filters and optical elements are charged at current full replacement cost, which may include import duty, customs charges, and freight. We provide original supporting documents for any such claim.</p>
            <p>Whether another person caused the damage, whether a crew member, cast member, client, or third party, does not affect your liability to us. You remain responsible, and it is for you to recover from that person.</p>
            <p>Where an item has been discontinued by its manufacturer, it is replaced with the current equivalent model and you are liable for the difference in cost.</p>
            <p>We notify you of any damage or shortage found on inspection and provide a written breakdown of the amount claimed. Our failure to identify damage immediately on return does not waive our claim.</p>
          </Section>

          <Section title="14. Loss of Earnings">
            <p>Equipment that is lost, stolen, or out of service for repair cannot be hired to anyone else. Where that happens through loss, theft, or damage for which you are liable, we may in addition claim loss of earnings.</p>
            <p>Loss of earnings is calculated as {RENTAL_POLICIES.lossOfEarnings.percentOfHireValue}% of the total hire value, or {RENTAL_POLICIES.lossOfEarnings.minimumWeeks} weeks of hire at the applicable rate, whichever is the higher, excluding VAT.</p>
            <p>For theft or loss, the period runs from the date the incident is reported to the South African Police Service and a case number is issued. For damage, it runs from the date the damage is reported to us until the date a repaired or replacement item is back in service.</p>
            <p>Loss of earnings is claimed by invoice as a debt due to us. It is not deducted automatically from your deposit and it is not charged to your card without notice. Each claim is assessed on its own facts and we will discuss it with you before invoicing.</p>
          </Section>

          <Section title="15. Insurance">
            <p><span className="text-white">Please read this section carefully.</span> {STUDIO.shortName} does not currently carry insurance cover on equipment while it is out on hire. From the moment equipment is handed to you until it is returned and inspected, you carry the full risk of loss, theft, and damage, and you are liable for the full replacement or repair cost as set out in section 13.</p>
            <p>We strongly advise every hirer to arrange equipment cover as part of their production insurance, and to satisfy themselves that the cover is adequate for the value of the equipment hired and for the conditions it will be used in. Production policies commonly exclude theft from an unattended vehicle, equipment left unsupervised, water damage, aerial work, and use by unqualified operators. Checking the terms of your own policy is your responsibility.</p>
            <p>If we introduce our own cover in future, the position will be set out in this section and confirmed to you in writing before your hire begins. Until then, no cover is in place.</p>
          </Section>

          <Part title="Part C — Production and Creative Services" />

          <Section title="16. Booking, Delivery and Approval">
            <p>Production and creative service bookings are made for an agreed number of hours, from {STUDIO.booking.minBookingHours} hour up to {STUDIO.booking.maxBookingHours} hours, at the rate confirmed in your booking. Rates are shown excluding VAT and VAT is added at checkout.</p>
            <p>A booking moves through a fixed sequence: you pay, the assigned creator accepts the booking, the work is carried out, and the deliverables are submitted to you.</p>
            <p><span className="text-white">Approval and the 7 day window.</span> Once deliverables are submitted you have 7 days to review them and either approve them or raise an issue with us. If you do not respond within 7 days, the delivery is approved automatically and the booking is treated as complete. We remind you of this when the deliverables are sent. If something is wrong, tell us inside that window.</p>
            <p>Bookings that remain accepted but incomplete for 30 days are closed automatically. Cancellation and refunds for service bookings are dealt with in our{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations Policy</Link>.
            </p>
            <p>Rights in production deliverables are dealt with in your production agreement.</p>
          </Section>

          <Part title="Part D — Creators and Suppliers" />

          <Section title="17. Creators and Suppliers">
            <p>This section applies if you supply equipment or services to {STUDIO.shortName} as a verified creator or partner. It does not apply to you as a customer.</p>
            <p>You supply to {STUDIO.legal.companyName}, not to the client. We are the merchant of record on every order, we contract with the client, and we carry the client facing obligation for that order, including any refund. In return, you agree not to solicit payment directly from a client introduced through the platform for work booked through the platform.</p>
            <p>You warrant that you own, or have the right to hire out, every item you list; that it is in safe and working condition and accurately described; and that you hold any licences or permits your services require.</p>
            <p>Listings may be drafted, described, and priced with the assistance of our AI tools. Anything generated that way is a suggestion. It is published only once you have reviewed and confirmed it, and you remain responsible for the accuracy of your listings and rates.</p>
            <p>Amounts due to you are paid to the bank account you register with us, after the client has approved the work or the approval window has passed, and after the funds for that order have cleared. Our current commission is shown in your dashboard.</p>
            <p>Where disputes are opened against your account we may withhold payouts pending resolution. Accounts with three or more open disputes are suspended and their listings are removed from sale. We will tell you when this happens and why.</p>
          </Section>

          <Part title="Part E — General" />

          <Section title="18. Cancellations and Refunds">
            <p>Cancellation windows, deposit release, refund timeframes, faulty or misdescribed equipment, and your cooling off rights are all set out in our{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations Policy</Link>, which forms part of these terms.
            </p>
            <p>In summary: if we cancel your booking, or cannot supply what you paid for, you receive a full refund of everything you paid with no deduction.</p>
            <p>If you cancel an equipment hire, the refund is worked out from the notice you give and processed automatically. More than 48 hours before the hire starts, the hire charge is refunded in full; between 24 and 48 hours, half is refunded; inside 24 hours the hire charge is not refunded. Your security deposit comes back in full either way. You are shown the exact figures before you confirm.</p>
            <p>Nothing in these terms limits your rights under the Consumer Protection Act 68 of 2008 or the Electronic Communications and Transactions Act 25 of 2002.</p>
          </Section>

          <Section title="19. Disputes and Complaints">
            <p>If you are unhappy with an order, a charge, or the condition of equipment, contact us first so that we can put it right. Email{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>{' '}
              with your booking reference and a description of the issue, or call {STUDIO.phone} during business hours.
            </p>
            <p>We acknowledge every complaint within 2 business days and aim to resolve it within 10 business days. If we need longer, we tell you why and give you a revised date. Our written resolution sets out the outcome and any refund or credit due to you.</p>
            <p>If you are not satisfied with the outcome, you may escalate the matter in writing to{' '}
              <a href={`mailto:${STUDIO.email}`} className={link}>{STUDIO.email}</a>{' '}
              for review by management. You keep the right to refer an unresolved complaint to the National Consumer Commission or to a court of competent jurisdiction in South Africa.
            </p>
          </Section>

          <Section title="20. Chargebacks">
            <p>If you do not recognise a charge from {STUDIO.shortName}, please contact us before raising a dispute with your bank, as most queries are resolved the same day. Where a chargeback is raised, we supply your bank and our payment provider with the booking record, the collection or delivery confirmation, the return and inspection record, and the correspondence relating to the transaction. Chargebacks raised in bad faith, where the equipment or service was supplied as agreed, may be recovered from you as a debt.</p>
          </Section>

          <Section title="21. Intellectual Property">
            <p>All content on this site, including text, graphics, logos, images, and software, is the property of {STUDIO.shortName} or its content suppliers and is protected by copyright law. The {STUDIO.shortName} name and logo are trademarks of {STUDIO.legal.companyName}.</p>
            <p>We are not responsible for obtaining copyright, clearances, or permissions for any material you supply to us or shoot using our equipment. That responsibility is yours.</p>
          </Section>

          <Section title="22. AI Assistant (Ubunye)">
            <p>The Ubunye AI assistant provides estimates, recommendations, and general guidance. AI generated content is informational only and is not professional advice or a binding quotation. Actual costs, availability, and specifications are confirmed in your written booking confirmation, which prevails over anything the assistant tells you.</p>
            <p>Conversations with Ubunye are stored on our systems. See our{' '}
              <Link href="/privacy" className={link}>Privacy Policy</Link>{' '}for how that data is handled.
            </p>
          </Section>

          <Section title="23. Data and Media Handling">
            <p>Where we provide any form of data transfer, copying, or media handling service, we are not liable for loss of footage, data, or media however caused. Keep your own backups. Media and deliverables may be withheld until payment for the related services has been received in full.</p>
          </Section>

          <Section title="24. User Content">
            <p>By uploading content such as portfolio images, profile information, or listings to the platform, you grant {STUDIO.shortName} a non-exclusive, royalty-free licence to display that content on the platform. You retain ownership of your content and may remove it at any time.</p>
          </Section>

          <Section title="25. Prohibited Conduct">
            <p>You may not create fake accounts, submit fraudulent verification documents, manipulate reviews or ratings, offer equipment you do not own or have no right to supply, or use the platform for any unlawful purpose.</p>
          </Section>

          <Section title="26. Limitation of Liability">
            <p>To the extent permitted by law, {STUDIO.shortName} is not liable for indirect, incidental, special, or consequential damages arising from the use of, or inability to use, our services or website, including loss of production time, loss of profit, or the cost of a reshoot. Our liability for any claim arising from an order is limited to the amount you paid for that order.</p>
            <p>Nothing in this section excludes or limits liability that cannot lawfully be excluded or limited, including under the Consumer Protection Act 68 of 2008.</p>
          </Section>

          <Section title="27. Changes to These Terms">
            <p>We may update these terms from time to time. The version in force on the date you place an order applies to that order, and the current version is always available on this page. Where a change materially affects your rights, we will tell you.</p>
          </Section>

          <Section title="28. Governing Law">
            <p>These terms are governed by and construed in accordance with the laws of South Africa. Any dispute arising under these terms is subject to the jurisdiction of the courts of South Africa sitting in {STUDIO.location.city}.</p>
          </Section>

          <Section title="29. Contact">
            <p>
              {STUDIO.legal.companyName}<br />
              {STUDIO.legal.registeredAddress && (<>{STUDIO.legal.registeredAddress}<br /></>)}
              Registration number {STUDIO.legal.registrationNumber}<br />
              {STUDIO.legal.vatNumber && (<>VAT number {STUDIO.legal.vatNumber}<br /></>)}
              Telephone {STUDIO.phone}<br />
              General{' '}
              <a href={`mailto:${STUDIO.email}`} className={link}>{STUDIO.email}</a>
              {' '}| Support{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className={link}>{STUDIO.supportEmail}</a>
              <br />
              {STUDIO.hours.weekday} | {STUDIO.hours.weekend} | {STUDIO.hours.sunday}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Part({ title }: { title: string }) {
  return (
    <div className="pt-6 first:pt-0">
      <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#D4A843]">{title}</h2>
      <div className="w-full h-px bg-white/10 mt-3" />
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
