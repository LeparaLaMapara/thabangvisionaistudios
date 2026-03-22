import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    `${STUDIO.shortName} Terms of Service — rental agreements, intellectual property, and governing law.`,
};

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

        <p className="text-sm font-mono text-neutral-500 mb-10">Last Updated: March 2026</p>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Section title="1. Acceptance of Terms">
            <p>By accessing and using the {STUDIO.shortName} website and services, including our rental, marketplace, and production tools, you agree to comply with and be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>
          </Section>

          <Section title="2. Account Registration">
            <p>To access certain features of the platform, you must create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must provide accurate and complete information during registration.</p>
          </Section>

          <Section title="3. Identity Verification">
            <p>Certain platform features (listing gear, accepting gigs) require identity verification. By submitting verification documents, you confirm that you are the person depicted in the documents and that all information is accurate. Fraudulent submissions will result in permanent account suspension.</p>
          </Section>

          <Section title="4. Rental Agreement">
            <p>All equipment rentals are subject to our standard Rental Agreement. This agreement covers insurance requirements, liability for damage, deposit requirements ({STUDIO.rental.depositPercent}% deposit), and return protocols. Renters are liable for any damage or loss during the rental period.</p>
          </Section>

          <Section title="5. Marketplace">
            <p>Verified creators may list equipment for rent on the marketplace. {STUDIO.shortName} charges a 10% platform fee on marketplace transactions. Sellers are responsible for the accuracy of their listings and the condition of their equipment. {STUDIO.shortName} acts as a facilitator and is not a party to transactions between buyers and sellers.</p>
          </Section>

          <Section title="6. Payments">
            <p>All payments are processed through PayFast in South African Rand (ZAR). Prices are inclusive of VAT at {STUDIO.booking.vatRate}%. Refund policies vary by service type. Equipment rental deposits are refundable upon safe return of gear.</p>
          </Section>

          <Section title="7. Intellectual Property">
            <p>All content on this site, including but not limited to text, graphics, logos, images, and software, is the property of {STUDIO.shortName} or its content suppliers and protected by international copyright laws. The &ldquo;{STUDIO.shortName}&rdquo; name and logo are trademarks of {STUDIO.legal.tradingAs}.</p>
          </Section>

          <Section title="8. AI Assistant (Ubunye)">
            <p>The Ubunye AI assistant provides estimates, recommendations, and general guidance. All AI-generated content is for informational purposes only and does not constitute professional advice. Actual costs, availability, and specifications may vary. {STUDIO.shortName} is not liable for decisions made based on AI recommendations.</p>
          </Section>

          <Section title="9. User Content">
            <p>By uploading content (portfolio images, profile information, listings) to the platform, you grant {STUDIO.shortName} a non-exclusive, royalty-free license to display that content on the platform. You retain ownership of your content and may remove it at any time.</p>
          </Section>

          <Section title="10. Prohibited Conduct">
            <p>You may not: create fake accounts, submit fraudulent verification documents, manipulate reviews or ratings, list equipment you do not own, use the platform for illegal purposes, or attempt to circumvent platform fees by arranging off-platform payments.</p>
          </Section>

          <Section title="11. Limitation of Liability">
            <p>{STUDIO.shortName} shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use our services or website, including but not limited to damages arising from equipment rental disputes between users.</p>
          </Section>

          <Section title="12. Governing Law">
            <p>These terms shall be governed by and construed in accordance with the laws of South Africa. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts located in {STUDIO.location.city}.</p>
          </Section>

          <Section title="13. Contact">
            <p>For questions about these Terms, contact us at{' '}
              <a href={`mailto:${STUDIO.email}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.email}
              </a>.
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
