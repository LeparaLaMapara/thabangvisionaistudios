import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { FaqsAdmin } from './FaqsAdmin';

export const metadata: Metadata = { title: 'FAQ Management — Admin' };
export const dynamic = 'force-dynamic';

export type Faq = {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_conversation_id: string | null;
  is_published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
};

export default async function FaqsPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  const supabase = createAdminClient();
  const { data: faqs } = await supabase
    .from('chat_faqs')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-1">
          Admin
        </p>
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">
          FAQ Management
        </h1>
        <p className="text-sm text-neutral-400 mt-2">
          Review AI-generated draft FAQs from chat conversations. Publish entries to make them visible on the public FAQ page.
        </p>
      </header>

      <FaqsAdmin faqs={(faqs as Faq[]) ?? []} />
    </div>
  );
}
