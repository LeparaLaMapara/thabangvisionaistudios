import { Suspense } from 'react';
import UbunyeStudioClient from './UbunyeStudioClient';
import { getFlag } from '@/lib/features';

/**
 * Plan: one question ("What are you planning?"), four occasions and the
 * box; Ubunye is the intelligence behind it. The old /ubunye-ai-studio
 * redirects here (next.config.ts). It reads the People switch (the error fallback links to /people,
 * not /book), the plans switch, and whether photos are on.
 */
export default async function PlanPage() {
  const [people, plans] = await Promise.all([getFlag('roles_v1'), getFlag('ubunye_projects')]);
  // Photos ride on ubunye_projects until the owner gives them their own switch.
  const photosEnabled = plans;
  return (
    <Suspense>
      <UbunyeStudioClient people={people} plans={plans} photos={photosEnabled} />
    </Suspense>
  );
}
