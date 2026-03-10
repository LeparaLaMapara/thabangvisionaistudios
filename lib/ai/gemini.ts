import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  AIProvider,
  Message,
  SendMessageOptions,
  SendMessageResult,
} from './types';

// ─── Gemini Provider ─────────────────────────────────────────────────────────

const MODEL = 'gemini-1.5-pro';

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return new GoogleGenerativeAI(apiKey);
}

export const gemini: AIProvider = {
  name: 'gemini',

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  },

  async sendMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const client = getClient();

    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      },
    });

    // Convert message history to Gemini format
    // Gemini uses 'user' and 'model' roles, and the last message must be from 'user'
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('The last message must be from the user');
    }

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response.text();

    return { response };
  },
};
