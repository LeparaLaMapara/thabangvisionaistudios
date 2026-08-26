import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `${STUDIO.shortName} Privacy Policy — what personal information we collect, who processes it, how long we keep it, and your rights under POPIA.`,
};

const LAST_UPDATED = 'August 2026';

export default function PrivacyPage() {
  const link = 'text-[#D4A843] hover:text-[#D4A843]/80 transition-colors';
  const officer = STUDIO.legal.informationOfficer;
  const regulator = STUDIO.legal.informationRegulator;

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

        <p className="text-sm font-mono text-neutral-500 mb-10">Last Updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Section title="1. Who Is Responsible for Your Information">
            <p>This policy is issued under the Protection of Personal Information Act 4 of 2013 (POPIA). It explains what personal information {STUDIO.shortName} collects, why, who else processes it, how long we keep it, and what you can require of us.</p>
            <p>The responsible party is:</p>
            <p>
              {STUDIO.legal.companyName}<br />
              {STUDIO.legal.registeredAddress && (<>{STUDIO.legal.registeredAddress}<br /></>)}
              Registration number {STUDIO.legal.registrationNumber}<br />
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>
            </p>
            {officer.name ? (
              <p>Our designated Information Officer is {officer.name}, reachable at{' '}
                <a href={`mailto:${officer.email}`} className={link}>{officer.email}</a>.
              </p>
            ) : (
              <p>Privacy matters are handled by our Information Officer, reachable at{' '}
                <a href={`mailto:${officer.email}`} className={link}>{officer.email}</a>.
              </p>
            )}
          </Section>

          <Section title="2. What We Collect">
            <p><span className="text-white">Account and profile.</span> Name, email address, phone number, display name, bio, skills, and avatar photo.</p>
            <p><span className="text-white">Address and location.</span> Street address, city, province, postal code, and the geographic coordinates of the address you give us. Coordinates are used to match you with nearby crew and equipment.</p>
            <p><span className="text-white">Identity verification.</span> Photographs of your identity document and a selfie holding it. We also record technical detail extracted from those images, including the date they were taken, device make and model, and any GPS coordinates embedded in them, together with your IP address and browser at the time of submission. We do not ask for or store your ID number as a separate field, but the document image itself contains it.</p>
            <p><span className="text-white">Banking details</span>, if you receive payouts as a creator: bank name, branch code, account type, account holder name, and the last four digits of your account number. Your full account number is passed straight to our payment provider to set up your payouts and is not kept on our systems.</p>
            <p><span className="text-white">Bookings and transactions.</span> What you booked, when, for how long, project descriptions, deliverables, amounts paid, and equipment condition records and photographs at collection and return.</p>
            <p><span className="text-white">Communications.</span> Messages you send through the platform, support requests, contact form submissions, and bug reports, including the device and browser details attached to a bug report.</p>
            <p><span className="text-white">Conversations with Ubunye</span>, our AI assistant. These are stored on our systems, not only in your browser. See section 6.</p>
            <p><span className="text-white">Technical and usage data.</span> IP address, browser and device information, pages viewed, and actions taken on the platform. We keep our own record of platform events for product analytics. Where you use Ubunye without signing in, we identify the session by a hashed version of your IP address rather than the address itself.</p>
          </Section>

          <Section title="3. Why We Process It, and On What Basis">
            <p>To perform our contract with you: creating and managing your account, taking payment, fulfilling bookings, arranging collection and return, settling deposits, and paying creators.</p>
            <p>To meet legal obligations: keeping tax and transaction records, and complying with lawful requests.</p>
            <p>For our legitimate interests: preventing fraud and identity theft, securing the platform, resolving disputes, and improving the product.</p>
            <p>With your consent: identity verification processing, and marketing. Consent for verification is captured explicitly before you upload anything, and recorded with a version and timestamp. You can withdraw consent at any time, though we cannot verify your identity, and therefore cannot let you hire equipment, without it.</p>
          </Section>

          <Section title="4. Identity Verification in Detail">
            <p>This is the most sensitive information we hold, so we set it out separately.</p>
            <p><span className="text-white">Where it is stored.</span> Your identity document and selfie are stored in a private, access-controlled storage bucket on our Supabase infrastructure. They are not public, and staff access is through short-lived signed links that expire after five minutes.</p>
            <p><span className="text-white">Automated checks.</span> To confirm that the person in the selfie is the person on the document, and that the document appears genuine, both images are sent to Google&rsquo;s AI services for an automated comparison. This means copies of your identity document and selfie are processed by Google, outside South Africa. We do this only for verification, and the result we keep is a match outcome and a confidence score.</p>
            <p><span className="text-white">Duplicate detection.</span> We store a one-way cryptographic fingerprint of the document file so that the same document cannot be used to verify several accounts. The fingerprint cannot be reversed to recreate the document.</p>
            <p><span className="text-white">How long we keep it.</span> The document and selfie images are deleted automatically {STUDIO.legal.popia.retentionDays} days after your verification has been reviewed. The technical detail described in section 2, the document fingerprint, and the outcome of the review are kept for longer, for fraud prevention and to show that we verified you properly. Your verification status and consent record are kept for the life of your account plus five years for tax and legal audit purposes.</p>
          </Section>

          <Section title="5. Who Else Processes Your Information">
            <p>We use the following operators. Each processes only what it needs to, under our instruction.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-white">Supabase</span> — database, authentication, and file storage. Holds effectively everything described above.</li>
              <li><span className="text-white">Paystack</span> — payments and creator payouts. Receives your email address and transaction detail, and for payouts, the account holder name, bank account number, and branch code.</li>
              <li><span className="text-white">PayFast</span> — an alternative payment provider we keep available. Not currently active.</li>
              <li><span className="text-white">Cloudinary</span> — image hosting for avatars, portfolios, and listing photographs. Verification documents are <span className="text-white">not</span> stored here.</li>
              <li><span className="text-white">Google</span> — AI services used for the verification checks in section 4, for lower-cost assistant responses, and for search indexing of platform content.</li>
              <li><span className="text-white">Anthropic</span> — the AI model behind Ubunye. Receives your messages and, when you are signed in, relevant context from your profile and bookings.</li>
              <li><span className="text-white">Vercel</span> — hosting, plus page-view and performance analytics.</li>
              <li><span className="text-white">Google Workspace (Gmail)</span> — outbound email. Receives recipient addresses and message contents.</li>
              <li><span className="text-white">Twilio</span> — WhatsApp messaging, where you contact us on that channel.</li>
              <li><span className="text-white">OpenStreetMap</span> — address lookup. When you type an address into our address field, that text is sent from your browser to OpenStreetMap&rsquo;s servers to suggest matches.</li>
            </ul>
            <p>We do not sell your personal information, and we do not share it for anyone else&rsquo;s marketing.</p>
          </Section>

          <Section title="6. Ubunye AI Conversations">
            <p>Your conversations with Ubunye are stored in our database against your account, or against a hashed session identifier if you are not signed in. Authorised administrators can review them for support, safety, and quality purposes.</p>
            <p>Message content is sent to our AI providers to generate a response. Please do not paste identity numbers, banking details, passwords, or other sensitive information into the assistant.</p>
          </Section>

          <Section title="7. Cross-Border Transfers">
            <p>Several of the operators above process personal information outside South Africa. Where that happens we rely on section 72 of POPIA: the recipient is bound by an agreement or by laws that provide a comparable level of protection to POPIA, or the transfer is necessary to perform our contract with you.</p>
            <p>The transfer that matters most to you is the one described in section 4: your identity document and selfie are processed by Google outside South Africa as part of verification.</p>
          </Section>

          <Section title="8. How Long We Keep Things">
            <ul className="list-disc pl-5 space-y-1">
              <li>Identity document and selfie images — deleted {STUDIO.legal.popia.retentionDays} days after review.</li>
              <li>Verification outcome, technical detail, and document fingerprint — retained for fraud prevention.</li>
              <li>Consent records and verification status — account life plus 5 years.</li>
              <li>Transaction and booking records — 5 years, as tax law requires.</li>
              <li>Banking details (bank, account holder, last four digits, payout reference) — until you remove them or your account is closed.</li>
              <li>Profile and account data — deleted within 30 days of account closure, except where we must keep a record.</li>
              <li>Ubunye conversations and platform event logs — retained while they remain useful for support, safety, and product analytics.</li>
            </ul>
          </Section>

          <Section title="9. Security">
            <p>Access to the database is controlled by row-level security rules so that, as a rule, you can read only your own records. Verification documents sit in a private bucket reached only through expiring signed links. Transport is encrypted. Sessions log out automatically after {STUDIO.session.idleTimeoutMinutes} minutes of inactivity. We keep an audit trail of administrative actions.</p>
            <p>We do not store full bank account numbers. When you add banking details, the number goes directly to our payment provider, which returns a reference we use to pay you. We keep only the last four digits, so you can recognise the account. Even so, access to that record is restricted at the database level to the account that owns it.</p>
            <p>No system is perfectly secure. If a breach affects your personal information, we will notify you and the Information Regulator as POPIA requires.</p>
          </Section>

          <Section title="10. Cookies and Analytics">
            <p>We use essential cookies for sign-in and session management. Without them the platform cannot keep you logged in.</p>
            <p>We also use analytics that record page views, performance, and how the platform is used. We do not currently show a cookie consent banner, and we do not use advertising or cross-site tracking cookies. You can block or remove cookies in your browser settings, though sign-in will stop working if you block the essential ones.</p>
          </Section>

          <Section title="11. Marketing">
            <p>We send transactional messages — booking confirmations, verification outcomes, deposit and dispute notices — because they are necessary to perform our contract with you. These are not marketing and you cannot opt out of them while you hold an active booking.</p>
            <p>Marketing emails are sent only if you have opted in, and opting in is always a separate, unticked choice. To stop receiving them, email{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>{' '}
              and we will remove you.
            </p>
          </Section>

          <Section title="12. Your Rights">
            <p>Under POPIA you may:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>ask what personal information we hold about you, and get a copy;</li>
              <li>ask us to correct or complete anything inaccurate;</li>
              <li>ask us to delete information we no longer have a lawful reason to keep;</li>
              <li>object to processing based on our legitimate interests;</li>
              <li>withdraw a consent you previously gave;</li>
              <li>complain to the Information Regulator.</li>
            </ul>
            <p>To exercise any of these, email{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>{' '}
              from the address on your account. There is currently no self-service delete button in the dashboard, so account deletion is handled by us on request. We respond within 30 days, and we may need to confirm your identity first.
            </p>
            <p>Some information we must keep even after you ask us to delete it, in particular transaction records required by tax law. We will tell you what we are keeping and why.</p>
          </Section>

          <Section title="13. Children">
            <p>The platform is for people aged 18 and over, and you confirm your age during verification. We do not knowingly collect information about children. If you believe a child has given us personal information, contact us and we will delete it.</p>
          </Section>

          <Section title="14. Complaints">
            <p>Raise a privacy concern with us first at{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>. We acknowledge within 2 business days and aim to resolve within 10.
            </p>
            <p>If you are not satisfied, you may complain to the {regulator.name}:</p>
            <p>
              {regulator.address}<br />
              Complaints{' '}
              <a href={`mailto:${regulator.complaintsEmail}`} className={link}>{regulator.complaintsEmail}</a><br />
              General{' '}
              <a href={`mailto:${regulator.generalEmail}`} className={link}>{regulator.generalEmail}</a><br />
              <a href={regulator.website} target="_blank" rel="noopener noreferrer" className={link}>{regulator.website}</a>
            </p>
          </Section>

          <Section title="15. Changes to This Policy">
            <p>We update this policy when our practices change. The current version is always on this page, with the date at the top. Where a change materially affects your rights, we will tell you directly.</p>
            <p>See also our{' '}
              <Link href="/legal" className={link}>Terms of Service</Link>{' '}and{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations Policy</Link>.
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
