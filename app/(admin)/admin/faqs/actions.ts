'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

export async function togglePublish(
  id: string,
  published: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, error: 'Not authorized.' };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('chat_faqs')
      .update({ is_published: published, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    revalidatePath('/admin/faqs');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to toggle publish.' };
  }
}

export async function updateFaq(
  id: string,
  data: { question: string; answer: string; category: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, error: 'Not authorized.' };

  if (!data.question.trim() || !data.answer.trim()) {
    return { ok: false, error: 'Question and answer are required.' };
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('chat_faqs')
      .update({
        question: data.question.trim(),
        answer: data.answer.trim(),
        category: data.category,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    revalidatePath('/admin/faqs');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update FAQ.' };
  }
}

export async function deleteFaq(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, error: 'Not authorized.' };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('chat_faqs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    revalidatePath('/admin/faqs');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete FAQ.' };
  }
}
