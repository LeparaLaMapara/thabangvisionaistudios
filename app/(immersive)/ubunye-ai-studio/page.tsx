import { Suspense } from 'react';
import UbunyeStudioClient from './UbunyeStudioClient';
import { getFlag } from '@/lib/features';

/**
 * Ask Ubunye: one question ("What are you planning?"), four occasions and
 * the box. It reads the People switch (the error fallback links to /people,
 * not /book), the plans switch, and whether photos are on.
 */
export default async function UbunyeAIStudioPage() {
  const [people, plans] = await Promise.all([getFlag('roles_v1'), getFlag('ubunye_projects')]);
  // Photos ride on ubunye_projects until the owner gives them their own switch.
  const photosEnabled = plans;
  return (
    <Suspense>
      <UbunyeStudioClient people={people} plans={plans} photos={photosEnabled} />
    </Suspense>
  );
}
