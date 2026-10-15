export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { EARN } from '@/lib/constants';

/** /join is public: it shows the Earn page, which says how it works before any sign-in. */
export default function JoinPage() {
  redirect(EARN.href);
}
