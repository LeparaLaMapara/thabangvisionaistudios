import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { OutreachAdmin } from './OutreachAdmin';

export const metadata: Metadata = { title: 'Outreach Agent — Admin' };
export const dynamic = 'force-dynamic';

export default async function OutreachPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">
          Admin
        </p>
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">
          Outreach Agent
        </h1>
        <p className="text-sm text-neutral-400 mt-2">
          Generate AI-powered B2B outreach emails for prospective clients.
        </p>
      </header>

      <OutreachAdmin />
    </div>
  );
}
