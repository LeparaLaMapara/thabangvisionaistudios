export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { OFFER_PATH } from '@/lib/welcome';

/** Old link from the first roles slice: a deep link into Offer, the one way to join. */
export default function JoinPage() {
  redirect(OFFER_PATH);
}
