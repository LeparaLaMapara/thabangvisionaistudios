import { Suspense } from 'react';
import UbunyeStudioClient from './UbunyeStudioClient';

/**
 * Ask Ubunye: just the box and a few example questions (clarity audit C12).
 * The featured gear and people strips, and their counts, are gone, so the
 * page no longer loads the studio context.
 */
export default function UbunyeAIStudioPage() {
  return (
    <Suspense>
      <UbunyeStudioClient />
    </Suspense>
  );
}
