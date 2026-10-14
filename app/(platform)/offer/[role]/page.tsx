export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { OFFER_PATH } from '@/lib/welcome';

/** Old deep link: the three-screen flow with the role preselected. */
export default async function OfferRolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(/^[a-z0-9-]{2,40}$/.test(role) ? `${OFFER_PATH}?role=${role}` : OFFER_PATH);
}
