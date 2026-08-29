import { createAdminClient } from '@/lib/supabase/server';
import { trackedCompletion } from '@/lib/ai/tracked';
import { getModel } from '@/lib/ai';
import { generateText } from 'ai';

/**
 * Extracts Q&A pairs from recent chat conversations and inserts them
 * as draft FAQ entries for admin review.
 *
 * Runs weekly. Only processes conversations with 3+ messages that
 * haven't already been indexed.
 */
export async function indexConversationFaqs(): Promise<{ extracted: number; skipped: number }> {
  const supabase = createAdminClient();

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: conversations } = await supabase
    .from('chat_conversations')
    .select('id, agent_id')
    .gte('message_count', 3)
    .gt('started_at', oneWeekAgo)
    .in('status', ['ended', 'converted']);

  if (!conversations || conversations.length === 0) {
    return { extracted: 0, skipped: 0 };
  }

  const { data: alreadyIndexed } = await supabase
    .from('chat_faqs')
    .select('source_conversation_id')
    .in('source_conversation_id', conversations.map((c) => c.id));

  const indexedIds = new Set((alreadyIndexed ?? []).map((f) => f.source_conversation_id));
  const toProcess = conversations.filter((c) => !indexedIds.has(c.id));

  if (toProcess.length === 0) {
    return { extracted: 0, skipped: conversations.length };
  }

  let extracted = 0;
  const batch = toProcess.slice(0, 10);

  for (const conv of batch) {
    try {
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true })
        .limit(20);

      if (!messages || messages.length < 2) continue;

      const transcript = messages
        .filter((m) => m.content)
        .map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`)
        .join('\n');

      const model = getModel();
      const result = await trackedCompletion({
        agentId: 'content-repurposer',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        call: async () => {
          const response = await generateText({
            model,
            prompt: `Extract 1-3 useful, general-purpose Q&A pairs from this chat transcript. These will be published as public FAQ entries on a creative production platform website.

Rules:
- Remove all personal info (names, emails, phone numbers, specific dates)
- Rephrase questions to be general (not "Can I book John?" but "How do I book a photographer?")
- Answers should be concise (2-3 sentences max)
- Only extract genuinely useful questions a visitor might search for
- Categorise each as: booking, pricing, equipment, creators, platform, general
- If the conversation is too specific or has no useful general Q&A, return NONE

TRANSCRIPT:
${transcript}

Format each Q&A as:
CATEGORY: <category>
Q: <question>
A: <answer>
---`,
          });
          return {
            result: response.text,
            usage: {
              inputTokens: response.usage?.inputTokens ?? 0,
              outputTokens: response.usage?.outputTokens ?? 0,
            },
          };
        },
      });

      if (result.trim() === 'NONE') continue;

      const pairs = result.split('---').filter((s) => s.trim());
      for (const pair of pairs) {
        const categoryMatch = pair.match(/CATEGORY:\s*(.+)/i);
        const questionMatch = pair.match(/Q:\s*(.+)/i);
        const answerMatch = pair.match(/A:\s*([\s\S]+?)(?=$|CATEGORY:|Q:)/i);

        if (questionMatch && answerMatch) {
          await supabase.from('chat_faqs').insert({
            question: questionMatch[1].trim(),
            answer: answerMatch[1].trim(),
            category: categoryMatch?.[1]?.trim().toLowerCase() ?? 'general',
            source_conversation_id: conv.id,
            is_published: false,
          });
          extracted++;
        }
      }
    } catch (err) {
      console.error(`[faq-indexer] Failed to process conversation ${conv.id}:`, err);
    }
  }

  return { extracted, skipped: conversations.length - batch.length };
}
