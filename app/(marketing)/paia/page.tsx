import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Access to Information',
  description: `How to ask ${STUDIO.shortName} for access to, correction of, or deletion of your personal information under POPIA and PAIA.`,
};

/**
 * PAIA / POPIA access requests. A plain, practical page: how to ask, what we
 * need from you, and where to complain. Draft pending legal review (see
 * docs/implementation/legal-review-checklist.md): the formal PAIA manual is
 * not yet published, and the Information Regulator's address in constants
 * needs to be confirmed.
 */
export default function PaiaPage() {
  const link = 'text-[#D4A843] hover:text-[#D4A843]/80 transition-colors';
  const officer = STUDIO.legal.informationOfficer;
  const regulator = STUDIO.legal.informationRegulator;

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-4xl">
        <div className="mb-12">
          <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
            Legal
          </span>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight">
            Access to Information
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-6" />
        </div>

        <div className="space-y-10 text-sm font-mono text-neutral-400 leading-relaxed">
          <Section title="1. What This Page Is For">
            <p>You have the right to know what personal information we hold about you, and to ask us to correct or delete it, under the Protection of Personal Information Act 4 of 2013 (POPIA) and the Promotion of Access to Information Act 2 of 2000 (PAIA). This page explains how to make that request.</p>
            <p>How we collect and use personal information is explained in our{' '}
              <Link href="/privacy" className={link}>Privacy Policy</Link>.
            </p>
          </Section>

          <Section title="2. Who to Contact">
            <p>
              {STUDIO.legal.companyName}, trading as {STUDIO.legal.tradingAs}<br />
              Registration number {STUDIO.legal.registrationNumber}
            </p>
            <p>
              {officer.name ? <>Information Officer: {officer.name}<br /></> : <>Information Officer<br /></>}
              Email{' '}
              <a href={`mailto:${officer.email}`} className={link}>{officer.email}</a>
            </p>
            {officer.email !== STUDIO.privacyEmail && (
              <p>You can also write to{' '}
                <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>.
              </p>
            )}
          </Section>

          <Section title="3. What You Can Ask For">
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="text-white">Access</span> — confirmation of whether we hold personal information about you, a description of it, and a copy.</li>
              <li><span className="text-white">Correction</span> — that we correct or complete information that is inaccurate, out of date or incomplete.</li>
              <li><span className="text-white">Deletion</span> — that we delete information we no longer have a lawful reason to keep. Some records, such as transaction records required by tax law, we must keep; we will tell you what we keep and why.</li>
              <li><span className="text-white">Objection</span> — to processing based on our legitimate interests, or to direct marketing.</li>
              <li><span className="text-white">Withdrawal of consent</span> — for processing that relies on your consent, such as the identity check.</li>
            </ul>
          </Section>

          <Section title="4. How to Make a Request">
            <p>Email{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>{' '}
              from the email address on your account, and tell us:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>your name and the email address on your account;</li>
              <li>what you are asking for (access, correction, deletion, objection or withdrawal of consent);</li>
              <li>for a correction, what is wrong and what it should say.</li>
            </ul>
            <p>Before we act on a request we may need to confirm that you are the account holder, so that your information is not given to, or changed by, someone else. We acknowledge your request {STUDIO.responseTime} and tell you if a prescribed form or fee applies to it before we proceed.</p>
            <p>The forms prescribed under POPIA and PAIA are available from the Information Regulator&rsquo;s website.</p>
          </Section>

          <Section title="5. Requests for Other Records">
            <p>If you want access to a record that is not your own personal information, you may make a request under PAIA. Send it to the Information Officer at the address above, describing the record you want. Our PAIA manual is being prepared; until it is published, the Information Officer will help you with the process.</p>
          </Section>

          <Section title="6. If You Are Not Satisfied">
            <p>Please raise a concern with us first. If you are not satisfied with how we handled your request, you may complain to the {regulator.name}:</p>
            <p>
              {regulator.address}<br />
              Complaints{' '}
              <a href={`mailto:${regulator.complaintsEmail}`} className={link}>{regulator.complaintsEmail}</a><br />
              General{' '}
              <a href={`mailto:${regulator.generalEmail}`} className={link}>{regulator.generalEmail}</a><br />
              <a href={regulator.website} target="_blank" rel="noopener noreferrer" className={link}>{regulator.website}</a>
            </p>
          </Section>

          <Section title="7. Related">
            <p>
              <Link href="/privacy" className={link}>Privacy Policy</Link>{' '}|{' '}
              <Link href="/legal" className={link}>Terms of Service</Link>{' '}|{' '}
              <Link href="/refunds" className={link}>Refunds, Returns and Cancellations</Link>
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
      <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
