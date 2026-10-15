import { Suspense } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { loadStudioContext } from '@/lib/supabase/queries/ubunyeStudio';
import UbunyeStudioClient from './UbunyeStudioClient';
import { getFlag } from '@/lib/features';
import type { StudioContext } from '@/types/ubunye';

const getStudioContext = unstable_cache(
  async (): Promise<StudioContext> => loadStudioContext(createAdminClient()),
  ['studio-context'],
  { revalidate: 300, tags: ['studio-context'] },
);

export default async function UbunyeAIStudioPage() {
  const [context, people] = await Promise.all([getStudioContext(), getFlag('roles_v1')]);

  return (
    <Suspense>
      <UbunyeStudioClient context={context} people={people} />
    </Suspense>
  );
}
