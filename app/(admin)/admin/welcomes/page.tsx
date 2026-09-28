import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { WelcomeQueue } from './WelcomeQueue';

export const metadata: Metadata = { title: 'Welcomes — Admin' };
export const dynamic = 'force-dynamic';

export default async function WelcomesPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">Admin</p>
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">Welcomes</h1>
        <p className="text-sm text-neutral-400 mt-2">
          Everyone who signs up gets one welcome, drafted by Ubunye from their first name and what they have done
          on the site. Nothing is sent until you press Send.
        </p>
      </header>
      <WelcomeQueue />
    </div>
  );
}
