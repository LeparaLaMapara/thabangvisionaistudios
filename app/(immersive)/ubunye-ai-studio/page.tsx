import { Suspense } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { loadStudioContext } from '@/lib/supabase/queries/ubunyeStudio';
import UbunyeStudioClient from './UbunyeStudioClient';
import type { StudioContext } from '@/types/ubunye';

const getStudioContext = unstable_cache(
  async (): Promise<StudioContext> => loadStudioContext(createAdminClient()),
  ['studio-context'],
  { revalidate: 300, tags: ['studio-context'] },
);

export default async function UbunyeAIStudioPage() {
  const context = await getStudioContext();

  return (
    <Suspense>
      <UbunyeStudioClient context={context} />
    </Suspense>
  );
}
