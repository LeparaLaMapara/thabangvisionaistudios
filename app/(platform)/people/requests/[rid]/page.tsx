export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getRequestForViewer } from '@/lib/supabase/queries/roles';
import { isAdmin } from '@/lib/auth';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { WhosComingCard } from '@/components/roles/WhosComingCard';
import { formatRands, requestHeading, requestReference, requestStatusWords, showPaymentDetails } from '@/lib/roles';
import { getClientNote } from '@/lib/supabase/queries/role-requests';
import { BANK_DETAILS_NEVER_CHANGE, BANK_LINES } from '@/lib/payments/eft';

export const metadata = buildPageMetadata({ title: 'Your request', description: 'Who, where, when.', path: '/people', noIndex: true });

/**
 * One booking request, as the viewer may see it (lib/roles/reveal.ts): the
 * client or the booked person only. The face and first name appear only once
 * the booking is confirmed and paid; until then the card is blind. Words for
 * each status come from lib/roles/request-loop.ts.
 */
export default async function RequestStatusPage({ params }: { params: Promise<{ rid: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { rid } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(`/people/requests/${rid}`));
  const card = await getRequestForViewer(rid, user.id, { staff: await isAdmin(user.id, user.email ?? undefined) });
  if (!card) notFound();
  const clientNote = card.viewer === 'client' && card.status === 'declined' ? await getClientNote(rid) : null;

  return (
    <div className="pt-28 pb-16 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-display font-medium text-white mb-2">{requestHeading(card.status, card.viewer)}</h1>
        <p className="text-neutral-400 mb-6">{requestStatusWords(card.status, card.viewer)}</p>
        {clientNote && <p className="text-neutral-300 mb-6 border-l-2 border-white/20 pl-3">{clientNote}</p>}
        {showPaymentDetails(card.status, card.viewer) && (
          <div className="border border-accent-gold/40 bg-accent-gold/5 p-4 mb-6 text-sm">
            <p className="text-white mb-2">Pay {card.totalCents !== null ? formatRands(card.totalCents) : 'the total below'} by EFT</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-300">
              {BANK_LINES.map((l) => (
                <div key={l.label} className="contents">
                  <dt className="text-neutral-500">{l.label}</dt>
                  <dd>{l.value}</dd>
                </div>
              ))}
              <dt className="text-neutral-500">Reference</dt>
              <dd className="font-mono text-accent-gold">{requestReference(rid)}</dd>
            </dl>
            <p className="text-xs text-neutral-500 mt-3">{BANK_DETAILS_NEVER_CHANGE}</p>
          </div>
        )}
        {card.viewer === 'person' && card.clientFirstName && <p className="text-white mb-4">Booked by {card.clientFirstName}</p>}
        <WhosComingCard card={card} title={card.viewer === 'client' ? "Who's coming" : 'Your job'} />
        {card.totalCents !== null && <p className="mt-4 text-lg text-white">Total {formatRands(card.totalCents)}</p>}
        {card.viewer === 'client' && (
          <p className="mt-8"><Link href="/dashboard/creator-requests" className="text-sm text-neutral-400 underline underline-offset-4">All your requests</Link></p>
        )}
      </div>
    </div>
  );
}
