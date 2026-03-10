import OpenAI from 'openai';
import type {
  AIProvider,
  Message,
  SendMessageOptions,
  SendMessageResult,
} from './types';

// ─── OpenAI Provider (GPT-4o) ────────────────────────────────────────────────

const MODEL = 'gpt-4o';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey });
}

export const openai: AIProvider = {
  name: 'openai',

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  },

  async sendMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';

    return { response: text };
  },
};
