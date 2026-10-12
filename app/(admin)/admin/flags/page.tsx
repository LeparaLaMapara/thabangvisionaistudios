import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAllFlags } from '@/lib/features';
import { FlagsTable } from './FlagsTable';

export const metadata: Metadata = { title: 'Site switches' };
export const dynamic = 'force-dynamic';

export default async function FlagsPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  const flags = await getAllFlags();

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-sm text-neutral-400">Settings</p>
        <h1 className="mt-1 text-2xl md:text-3xl font-display text-white tracking-tight">Site switches</h1>
        <p className="text-sm text-neutral-400 mt-2">
          Turn parts of the site on or off. A change reaches everyone within a minute.
        </p>
      </header>

      <FlagsTable flags={flags} />
    </div>
  );
}
