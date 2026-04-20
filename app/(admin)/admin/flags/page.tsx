import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAllFlags } from '@/lib/features';
import { FlagsTable } from './FlagsTable';

export const metadata: Metadata = { title: 'Feature Flags — Admin' };
export const dynamic = 'force-dynamic';

export default async function FlagsPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  const flags = await getAllFlags();

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">Feature Flags</h1>
        <p className="text-sm text-neutral-400 mt-2">
          Toggle platform features on or off. Changes take effect on the next request.
        </p>
      </header>

      <FlagsTable flags={flags} />
    </div>
  );
}
