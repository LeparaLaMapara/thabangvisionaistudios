// ─── AI Provider Abstraction ─────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export type Message = {
  role: MessageRole;
  content: string;
};

export type SendMessageOptions = {
  /** Maximum tokens to generate (default varies by provider) */
  maxTokens?: number;
  /** Sampling temperature 0–2 (default varies by provider) */
  temperature?: number;
};

export type SendMessageResult = {
  /** The assistant's response text */
  response: string;
};

/**
 * A stream of text chunks from the AI model.
 * Implements AsyncIterable so consumers can `for await (const chunk of stream)`.
 */
export type StreamMessageResult = AsyncIterable<string>;

/**
 * Unified AI provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `AI_PROVIDER` env var in `lib/ai/index.ts`.
 */
export interface AIProvider {
  /** Provider identifier (e.g., 'anthropic', 'gemini', 'openai') */
  readonly name: string;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /**
   * Send a message to the AI model and get a complete response.
   *
   * @param systemPrompt - System-level instructions for the model
   * @param messages - Conversation history (user/assistant turns)
   * @param options - Optional generation parameters
   */
  sendMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResult>;

  /**
   * Stream a message from the AI model, yielding text chunks as they arrive.
   *
   * @param systemPrompt - System-level instructions for the model
   * @param messages - Conversation history (user/assistant turns)
   * @param options - Optional generation parameters
   */
  streamMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<StreamMessageResult>;
}
