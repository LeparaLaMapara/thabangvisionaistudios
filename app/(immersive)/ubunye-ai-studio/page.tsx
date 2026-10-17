import { Suspense } from 'react';
import UbunyeStudioClient from './UbunyeStudioClient';
import { getFlag } from '@/lib/features';

/**
 * Ask Ubunye: just the box and a few example questions (clarity audit C12).
 * The featured gear and people strips, and their counts, are gone, so the
 * page no longer loads the studio context. It reads only the People switch,
 * so the error fallback links to /people (not /book) when People is on.
 */
export default async function UbunyeAIStudioPage() {
  const [people, plans] = await Promise.all([getFlag('roles_v1'), getFlag('ubunye_projects')]);
  return (
    <Suspense>
      <UbunyeStudioClient people={people} plans={plans} />
    </Suspense>
  );
}
