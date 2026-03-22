import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `${STUDIO.shortName} Privacy Policy — how we collect, use, and protect your personal information.`,
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
            Legal
          </span>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight">
            Privacy Policy
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-6" />
        </div>

        <p className="text-sm font-mono text-neutral-500 mb-10">Last Updated: March 2026</p>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Section title="1. Information We Collect">
            <p>We collect information you provide directly, including:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Account information: name, email address, phone number</li>
              <li>Profile information: display name, bio, skills, location, avatar photo</li>
              <li>Verification documents: ID photos, selfie with ID (for identity verification)</li>
              <li>Payment information: processed securely through PayFast (we do not store card details)</li>
              <li>Listing and booking data: equipment details, rental dates, pricing</li>
              <li>Communications: messages sent through the platform, support requests</li>
            </ul>
            <p className="mt-3">We also automatically collect device information, IP address, browser type, and usage data through cookies and analytics.</p>
          </Section>

          <Section title="2. How We Use Your Information">
            <p>We use collected information to:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Provide, maintain, and improve our services</li>
              <li>Process equipment bookings, marketplace transactions, and payments</li>
              <li>Verify user identity for platform trust and safety</li>
              <li>Send transactional emails (booking confirmations, payment receipts)</li>
              <li>Send marketing communications (which you can opt out of at any time)</li>
              <li>Detect and prevent fraud, abuse, and security incidents</li>
              <li>Comply with legal obligations</li>
            </ul>
          </Section>

          <Section title="3. Identity Verification Data">
            <p>Verification photos (ID document, selfie) are stored securely and used solely for identity verification purposes. We extract metadata (device info, GPS coordinates, timestamps) to detect fraud. Verification data is:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Stored in encrypted cloud storage (Cloudinary) with restricted access</li>
              <li>Accessible only to authorized administrators during verification review</li>
              <li>Retained for the duration of your account plus 12 months after account deletion</li>
              <li>Never shared with third parties except as required by law</li>
            </ul>
          </Section>

          <Section title="4. POPIA Compliance">
            <p>As a South African platform, we comply with the Protection of Personal Information Act (POPIA). You have the right to:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Access your personal information held by us</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal information</li>
              <li>Object to the processing of your personal information</li>
              <li>Withdraw consent for marketing communications</li>
              <li>Lodge a complaint with the Information Regulator</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, contact us at{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                {STUDIO.privacyEmail}
              </a>.
            </p>
          </Section>

          <Section title="5. Data Security">
            <p>We implement appropriate technical and organizational measures to protect your personal information, including:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Encryption in transit (TLS/HTTPS) and at rest</li>
              <li>Row-level security policies on our database (Supabase)</li>
              <li>Role-based access controls for administrative functions</li>
              <li>Regular security reviews and dependency audits</li>
            </ul>
            <p className="mt-3">No method of transmission over the Internet is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.</p>
          </Section>

          <Section title="6. Third-Party Services">
            <p>We use the following third-party services to operate the platform:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li><strong className="text-white">Supabase</strong> — authentication and database hosting</li>
              <li><strong className="text-white">Cloudinary</strong> — image and media storage</li>
              <li><strong className="text-white">PayFast</strong> — payment processing</li>
              <li><strong className="text-white">Vercel</strong> — website hosting and analytics</li>
              <li><strong className="text-white">Anthropic (Claude)</strong> — AI assistant (Ubunye)</li>
            </ul>
            <p className="mt-3">Each provider processes data in accordance with their own privacy policies. We do not sell your personal information to any third party.</p>
          </Section>

          <Section title="7. AI Data Usage">
            <p>Conversations with the Ubunye AI assistant are used to provide responses and are not stored permanently. We do not use your conversations to train AI models. Conversation history is stored in your browser session only and is cleared when you close the tab.</p>
          </Section>

          <Section title="8. Cookies">
            <p>We use essential cookies for authentication and session management. We may also use analytics cookies to understand how visitors use our site. You can instruct your browser to refuse cookies, though some platform features may not function properly without them.</p>
          </Section>

          <Section title="9. Data Retention">
            <p>We retain your personal information for as long as your account is active or as needed to provide services. After account deletion:</p>
            <ul className="list-disc ml-5 space-y-1 mt-2">
              <li>Profile data is deleted within 30 days</li>
              <li>Transaction records are retained for 5 years (legal/tax requirements)</li>
              <li>Verification documents are retained for 12 months</li>
            </ul>
          </Section>

          <Section title="10. Children">
            <p>Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us immediately.</p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. We will notify registered users of material changes via email. Your continued use of the platform after changes constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="12. Contact">
            <p>For privacy-related questions or to exercise your POPIA rights, contact our Information Officer:</p>
            <div className="mt-3 bg-[#0A0A0B] border border-white/5 p-5 space-y-1">
              <p className="text-white">{STUDIO.legal.tradingAs}</p>
              <p>Email:{' '}
                <a href={`mailto:${STUDIO.privacyEmail}`} className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
                  {STUDIO.privacyEmail}
                </a>
              </p>
              <p>{STUDIO.location.city}, {STUDIO.location.country}</p>
            </div>
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
