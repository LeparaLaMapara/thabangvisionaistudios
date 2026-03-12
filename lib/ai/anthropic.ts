import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  Message,
  SendMessageOptions,
  SendMessageResult,
  StreamMessageResult,
} from './types';

// ─── Anthropic Provider (Claude) ─────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  return new Anthropic({ apiKey });
}

export const anthropic: AIProvider = {
  name: 'anthropic',

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async sendMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const client = getClient();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Extract text from the response content blocks
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return { response: text };
  },

  async streamMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<StreamMessageResult> {
    const client = getClient();

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    async function* generate(): AsyncIterable<string> {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
    }

    return generate();
  },
};
