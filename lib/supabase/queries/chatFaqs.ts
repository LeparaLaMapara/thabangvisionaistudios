import { createAdminClient } from '@/lib/supabase/server';

export interface ChatFaq {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_conversation_id: string | null;
  is_published: boolean;
  view_count: number;
  created_at: string;
}

export async function getPublishedFaqs(limit = 50): Promise<ChatFaq[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('chat_faqs')
    .select('*')
    .eq('is_published', true)
    .order('view_count', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[chatFaqs] getPublishedFaqs error:', error.message);
    return [];
  }

  return (data ?? []) as ChatFaq[];
}

export async function getFaqsByCategory(category: string): Promise<ChatFaq[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('chat_faqs')
    .select('*')
    .eq('is_published', true)
    .eq('category', category)
    .order('view_count', { ascending: false });

  if (error) {
    console.error('[chatFaqs] getFaqsByCategory error:', error.message);
    return [];
  }

  return (data ?? []) as ChatFaq[];
}

export async function incrementFaqView(faqId: string): Promise<void> {
  const supabase = createAdminClient();

  await supabase.rpc('increment_faq_view', { faq_id: faqId }).then(({ error }) => {
    if (error) console.error('[chatFaqs] incrementFaqView error:', error.message);
  });
}
