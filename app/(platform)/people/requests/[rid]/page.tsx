export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getRequestForViewer } from '@/lib/supabase/queries/roles';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { WhosComingCard } from '@/components/roles/WhosComingCard';

export const metadata = buildPageMetadata({ title: 'Your booking', description: 'Who, where, when.', path: '/people', noIndex: true });

const STATUS_WORDS: Record<string, string> = {
  requested: 'Requested. We confirm the booking and the price with you, then payment is held until the work is done.',
  confirmed: 'Confirmed and paid. Your payment is held until the work is done.',
  completed: 'Done.',
  withdrawn: 'You withdrew this request.',
  declined: 'Not available for this one.',
};

/**
 * One booking request, as the viewer may see it (lib/roles/reveal.ts): the
 * client or the booked person only. The face and first name appear only once
 * the booking is confirmed; until then the card is blind.
 */
export default async function RequestStatusPage({ params }: { params: Promise<{ rid: string }> }) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { rid } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(`/people/requests/${rid}`));
  const card = await getRequestForViewer(rid, user.id);
  if (!card) notFound();

  return (
    <div className="pt-28 pb-16 px-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-display font-medium text-white mb-2">{card.viewer === 'client' ? 'Your booking' : 'Your job'}</h1>
        <p className="text-neutral-400 mb-6">{STATUS_WORDS[card.status] ?? card.status}</p>
        {card.viewer === 'person' && card.clientFirstName && <p className="text-white mb-4">Booked by {card.clientFirstName}</p>}
        <WhosComingCard card={card} title={card.viewer === 'client' ? "Who's coming" : 'Your job'} />
      </div>
    </div>
  );
}
