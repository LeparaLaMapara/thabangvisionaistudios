import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { ContentRepurposeAdmin } from './ContentRepurposeAdmin';

export const metadata: Metadata = { title: 'Content Repurpose — Admin' };
export const dynamic = 'force-dynamic';

export default async function ContentRepurposePage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  const supabase = createAdminClient();
  const { data: articles } = await supabase
    .from('press')
    .select('id, slug, title, published_at')
    .order('published_at', { ascending: false });

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">
          Admin
        </p>
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">
          Content Repurpose
        </h1>
        <p className="text-sm text-neutral-400 mt-2">
          Generate social posts, email snippets, and SEO variants from press articles using AI.
        </p>
      </header>

      <ContentRepurposeAdmin articles={articles ?? []} />
    </div>
  );
}
