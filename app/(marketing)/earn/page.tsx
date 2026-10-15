// Re-rendered every minute: the kinds of work listed follow the live roles
// and the roles_v1 flag, which are data, not constants.
export const revalidate = 60;

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { EARN, STUDIO } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { getRoles } from '@/lib/supabase/queries/roles';
import { earnContent } from '@/lib/content/earn';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildPageMetadata({
  title: EARN.label,
  description: `Who can earn on ${STUDIO.shortName}, how it works, what we keep and when you are paid. Signing up is free.`,
  path: '/earn',
});

/**
 * Earn with ThabangVision: one public page before any sign-in (clarity audit
 * C8). Every Earn and Join link lands here; the button at the end starts the
 * sign-up (Offer with roles_v1 on, creator setup with it off).
 */
export default async function EarnPage() {
  const rolesOn = await getFlag('roles_v1');
  const liveRoles = rolesOn ? (await getRoles()).filter((r) => r.status === 'live') : [];
  const c = earnContent({ rolesOn, liveRoles });

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-2xl space-y-12">
        <header>
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white tracking-tight">{EARN.label}</h1>
          <p className="mt-6 text-lg text-neutral-300 leading-relaxed">{EARN.copy}</p>
        </header>

        <Section title="Who can earn">
          <ul className="list-disc pl-5 space-y-2 text-neutral-300 leading-relaxed">
            {c.who.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>

        <Section title="How it works">
          <ol className="list-decimal pl-5 space-y-2 text-neutral-300 leading-relaxed">
            {c.steps.map((line) => <li key={line}>{line}</li>)}
          </ol>
        </Section>

        <Section title={`What ${STUDIO.shortName} keeps`}>
          <ul className="list-disc pl-5 space-y-2 text-neutral-300 leading-relaxed">
            {c.keeps.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>

        <Section title="When you get paid">
          <ul className="list-disc pl-5 space-y-2 text-neutral-300 leading-relaxed">
            {c.paid.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="text-sm text-neutral-400">
            The full rules are in our <Link href="/legal" className="underline underline-offset-4">terms</Link>.
          </p>
        </Section>

        <Link
          href={c.cta.href}
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[52px] bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
        >
          {c.cta.label} <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-white">{title}</h2>
      {children}
    </section>
  );
}
