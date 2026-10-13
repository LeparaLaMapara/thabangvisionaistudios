import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';
import { verifyUnsubscribe } from '@/lib/engagement/unsubscribe';

export const metadata: Metadata = {
  title: 'Email preferences',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Where the "Stop these emails" link in a lifecycle email lands. Opening the
 * page changes nothing (link scanners open links); the button does.
 */
export default async function EmailPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const u = one(params.u);
  const t = one(params.t);
  const done = one(params.done) === '1';
  const error = one(params.error);
  const valid = verifyUnsubscribe(u, t);
  const link = 'text-[#D4A843] hover:text-[#D4A843]/80 transition-colors';

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-xl">
        <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">Email preferences</span>
        <h1 className="text-3xl md:text-5xl font-display font-medium text-white uppercase tracking-tight">
          {done ? 'Done' : 'Stop these emails'}
        </h1>
        <div className="w-8 h-px bg-[#D4A843] mt-6 mb-10" />

        <div className="space-y-6 text-sm text-neutral-300 leading-relaxed">
          {done ? (
            <>
              <p className="text-white">We will not send you these emails again.</p>
              <p>
                You still get messages about bookings you make with us, such as confirmations and payment
                notices. Those are part of your booking, not marketing.
              </p>
              <p>
                <Link href="/" className={link}>Back to {STUDIO.name}</Link>
              </p>
            </>
          ) : valid ? (
            <>
              <p>
                Press the button to stop welcome notes, reminders to finish your signup, and tips from{' '}
                {STUDIO.name}. You do not need to sign in.
              </p>
              <form action="/api/engagement/unsubscribe" method="post">
                <input type="hidden" name="from" value="page" />
                <input type="hidden" name="u" value={u} />
                <input type="hidden" name="t" value={t} />
                <button
                  type="submit"
                  className="w-full min-h-[44px] bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest px-6 py-3 hover:opacity-90 transition-opacity"
                >
                  Stop these emails
                </button>
              </form>
              {error === 'save' && <p className="text-red-400" role="alert">That did not save. Please try again.</p>}
            </>
          ) : (
            <>
              <p className="text-white">
                {error === 'link' || u || t ? 'This link is not valid any more.' : 'Open this page from the link at the bottom of one of our emails.'}
              </p>
              <p>
                Email{' '}
                <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>{STUDIO.privacyEmail}</a>{' '}
                and we will stop the emails by hand.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
