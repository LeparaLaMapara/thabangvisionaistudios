export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { offerRolePath } from '@/lib/welcome';

/** Old link from the first roles slice: a deep link into Offer for one role. */
export default async function JoinRolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(/^[a-z0-9-]{2,40}$/.test(role) ? offerRolePath(role) : '/offer');
}
