import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    `${STUDIO.shortName} Terms of Service — services and equipment supplied, payment, cancellations, refunds, and dispute resolution.`,
};

const LAST_UPDATED = 'August 2026';

export default function LegalPage() {
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
          <Section title="1. Acceptance of Terms">
            <p>By accessing or using the {STUDIO.shortName} website and services, including equipment hire, production services, and our online booking tools, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>
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
            <p>Certain platform features require identity verification. By submitting verification documents you confirm that you are the person depicted in those documents and that all information provided is accurate. Fraudulent submissions result in permanent account suspension. Verification documents are handled in accordance with our Privacy Policy and POPIA.</p>
          </Section>

          <Section title="5. Services and Equipment">
            <p>{STUDIO.shortName} supplies professional production services and professional equipment on hire, including cameras and optics, lighting and power, grip and motion, audio, aerial support, and sound reinforcement, together with related crew and production services.</p>
            <p>Every listing shown on the platform, whether from our own fleet or contributed by a verified creator in our supplier network, is supplied to you by {STUDIO.legal.companyName} on the basis set out in section 2. Prices, availability, and specifications shown on the site are confirmed at the time of booking.</p>
          </Section>

          <Section title="6. Pricing and Payment">
            <p>All prices are quoted in South African Rand ({STUDIO.currency.code}).</p>
            {STUDIO.legal.vatNumber ? (
              <p>{STUDIO.legal.companyName} is registered for Value-Added Tax under VAT registration number {STUDIO.legal.vatNumber}. Equipment hire prices shown on this site include VAT at {STUDIO.booking.vatRate}%, and the VAT portion is itemised in your cart and on your invoice. Production and creative service rates are shown excluding VAT; VAT at {STUDIO.booking.vatRate}% is added at checkout and shown as a separate line on your quote and invoice. Refundable security deposits are not subject to VAT.</p>
            ) : (
              <p>Where VAT becomes applicable it is shown separately at checkout and on your invoice.</p>
            )}
            <p>Payments are processed by our authorised payment providers, Paystack and PayFast, over secure encrypted connections. We accept South African debit and credit cards together with the other payment methods presented at checkout. {STUDIO.shortName} does not store your full card details on our servers.</p>
            <p>Payment is collected by {STUDIO.legal.companyName} as principal. Funds are not held in escrow or in trust for any third party, and no part of your payment is disbursed to a third party on your behalf.</p>
            <p>A booking is confirmed only once payment or the required deposit has been received and we have sent you a written confirmation.</p>
          </Section>

          <Section title="7. Equipment Rental Agreement">
            <p>All equipment hire is subject to our standard Rental Agreement, which is provided to you before collection or delivery. A deposit of {STUDIO.rental.depositPercent}% of the rental value is payable on booking and is refundable in accordance with section 10.</p>
            <p>The hirer is responsible for the equipment for the full hire period and is liable for loss, theft, or damage occurring during that period, fair wear and tear excepted. Equipment may not be sub-hired, sold, or taken outside South Africa without our prior written consent. Standard hire periods run up to {STUDIO.rental.maxBookingDays} days, with longer terms by arrangement.</p>
          </Section>

          <Section title="8. Collection, Delivery and Return">
            <p>Equipment is collected from, or delivered to, the location recorded in your booking confirmation. We operate from {STUDIO.locations.map((l) => l.city).join(' and ')}, {STUDIO.location.province}. Delivery outside these areas is arranged on request and any additional fee is quoted to you before you pay.</p>
            <p>The person collecting must present the identity document used to verify the account. Equipment must be returned by the return time stated in your booking confirmation. Late returns are charged at the applicable daily rate for each additional day or part of a day.</p>
            <p>All returned equipment is inspected on receipt. Where production services are booked, the agreed deliverables are supplied within the timeframe recorded in your booking confirmation.</p>
          </Section>

          <Section title="9. Cancellations">
            <p>Equipment hire may be cancelled free of charge up to {STUDIO.rental.cancellationHours} hours before the start of the hire period. Cancellations inside that window are charged at {STUDIO.rental.depositPercent}% of the booking value and the balance is refunded to you.</p>
            <p>Production and creative service bookings may be cancelled free of charge up to 48 hours before the scheduled shoot date. After that point the booking is non-refundable, because crew and equipment have been committed to your date.</p>
            <p>If we cancel your booking, or if we are unable to supply the equipment or service you paid for, you receive a full refund of everything you paid, with no deduction.</p>
            <p>To cancel, email{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.supportEmail}
              </a>{' '}
              or call {STUDIO.phone} from the account used to make the booking. A cancellation takes effect from the time we receive it.
            </p>
          </Section>

          <Section title="10. Refunds">
            <p>Refund requests are approved or declined within 2 business days. Approved refunds are processed within 5 business days of approval and are paid to the original payment method used for the transaction. Depending on your bank, funds typically reflect within a further 5 to 10 business days.</p>
            <p>Rental deposits are refunded in full within 5 business days of the equipment being returned and passing inspection. Where equipment is returned damaged, incomplete, or late, the cost of repair, replacement, or the late fee is deducted from the deposit and we send you a written breakdown of the deduction. Any balance is refunded to you.</p>
            <p>If equipment or a service is not supplied as described, tell us within 7 days. Where the fault is ours, you may choose a re-supply or a full refund.</p>
            <p>Refunds are made in {STUDIO.currency.code} and we do not charge a fee to process a refund. Nothing in these terms limits your rights under the Consumer Protection Act 68 of 2008.</p>
          </Section>

          <Section title="11. Disputes and Complaints">
            <p>If you are unhappy with an order, a charge, or the condition of equipment, contact us first so that we can put it right. Email{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.supportEmail}
              </a>{' '}
              with your booking reference and a description of the issue, or call {STUDIO.phone} during business hours.
            </p>
            <p>We acknowledge every complaint within 2 business days and aim to resolve it within 10 business days. If we need longer, we tell you why and give you a revised date. Our written resolution sets out the outcome and any refund or credit due to you.</p>
            <p>If you are not satisfied with the outcome, you may escalate the matter in writing to{' '}
              <a href={`mailto:${STUDIO.email}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.email}
              </a>{' '}
              for review by management. You keep the right to refer an unresolved complaint to the National Consumer Commission or to a court of competent jurisdiction in South Africa.
            </p>
          </Section>

          <Section title="12. Chargebacks">
            <p>If you do not recognise a charge from {STUDIO.shortName}, please contact us before raising a dispute with your bank, as most queries are resolved the same day. Where a chargeback is raised, we supply your bank and our payment provider with the booking record, the collection or delivery confirmation, and the correspondence relating to the transaction. Chargebacks raised in bad faith, where the equipment or service was supplied as agreed, may be recovered from you as a debt.</p>
          </Section>

          <Section title="13. Intellectual Property">
            <p>All content on this site, including text, graphics, logos, images, and software, is the property of {STUDIO.shortName} or its content suppliers and is protected by copyright law. The {STUDIO.shortName} name and logo are trademarks of {STUDIO.legal.companyName}. Rights in production deliverables are dealt with in your production agreement.</p>
          </Section>

          <Section title="14. AI Assistant (Ubunye)">
            <p>The Ubunye AI assistant provides estimates, recommendations, and general guidance. AI generated content is informational only and is not professional advice or a binding quotation. Actual costs, availability, and specifications are confirmed in your written booking confirmation, which prevails over anything the assistant tells you.</p>
          </Section>

          <Section title="15. User Content">
            <p>By uploading content such as portfolio images, profile information, or listings to the platform, you grant {STUDIO.shortName} a non-exclusive, royalty-free licence to display that content on the platform. You retain ownership of your content and may remove it at any time.</p>
          </Section>

          <Section title="16. Prohibited Conduct">
            <p>You may not create fake accounts, submit fraudulent verification documents, manipulate reviews or ratings, offer equipment you do not own or have no right to supply, or use the platform for any unlawful purpose.</p>
          </Section>

          <Section title="17. Limitation of Liability">
            <p>To the extent permitted by law, {STUDIO.shortName} is not liable for indirect, incidental, special, or consequential damages arising from the use of, or inability to use, our services or website. Nothing in this section excludes liability that cannot be excluded under South African law, including under the Consumer Protection Act.</p>
          </Section>

          <Section title="18. Governing Law">
            <p>These terms are governed by and construed in accordance with the laws of South Africa. Any dispute arising under these terms is subject to the jurisdiction of the courts of South Africa sitting in {STUDIO.location.city}.</p>
          </Section>

          <Section title="19. Contact">
            <p>
              {STUDIO.legal.companyName}<br />
              {STUDIO.legal.registeredAddress && (<>{STUDIO.legal.registeredAddress}<br /></>)}
              Registration number {STUDIO.legal.registrationNumber}<br />
              Telephone {STUDIO.phone}<br />
              General{' '}
              <a href={`mailto:${STUDIO.email}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.email}
              </a>
              {' '}| Support{' '}
              <a href={`mailto:${STUDIO.supportEmail}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.supportEmail}
              </a>
              <br />
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
