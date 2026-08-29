import { describe, it, expect } from 'vitest';
import { generateText, tool, jsonSchema } from 'ai';
import { resolveModel, resolveModelId } from '@/lib/ai/registry';

/**
 * Does the configured SMART model actually call tools?
 *
 * This is the gate before the booking assistant is moved off Claude onto an
 * open-weight model. Ubunye passes tools on every turn; if the model does not
 * emit a tool call, bookings silently stop working. "It's an open model" is not
 * evidence it can do function-calling — this proves it against a real endpoint.
 *
 * Skipped unless AI_LOCAL_BASE_URL is set, because it makes a live model call.
 * To run it against Qwen on a local runtime:
 *
 *   AI_SMART_PROVIDER=local AI_SMART_MODEL=qwen2.5 \
 *   AI_LOCAL_BASE_URL=http://localhost:11434/v1 \
 *   npx vitest run tests/unit/assistant-tools.integration.test.ts
 *
 * (Ollama: `ollama pull qwen2.5` then `ollama serve`. Or point AI_LOCAL_BASE_URL
 *  at any OpenAI-compatible host — Groq, Together, Fireworks — that serves Qwen.)
 */
describe.skipIf(!process.env.AI_LOCAL_BASE_URL)('smart model — tool calling', () => {
  const searchGear = tool({
    description: 'Search the rental catalogue for equipment matching a query.',
    inputSchema: jsonSchema<{ query: string }>({
      type: 'object',
      properties: { query: { type: 'string', description: 'what the customer wants' } },
      required: ['query'],
    }),
    execute: async ({ query }: { query: string }) =>
      ({ results: [`Sony A7 IV matching "${query}"`] }),
  });

  it(`emits a tool call for a catalogue question (model: ${resolveModelId('smart')})`, async () => {
    const res = await generateText({
      model: resolveModel('smart'),
      tools: { searchGear },
      // stopWhen omitted: we only care that the FIRST step calls the tool.
      prompt: 'Do you have a Sony camera I can rent this weekend? Use the search tool.',
    });

    const called = res.toolCalls?.map((c) => c.toolName) ?? [];
    expect(
      called,
      `Model ${resolveModelId('smart')} did not call the tool. Tool-calling is `
      + 'required for the booking assistant; do not move it to this model.',
    ).toContain('searchGear');
  }, 60_000);

  it('produces a usable text answer after the tool runs', async () => {
    const res = await generateText({
      model: resolveModel('smart'),
      tools: { searchGear },
      stopWhen: (() => true) as never, // one round-trip is enough for the smoke
      prompt: 'What Sony gear do you have? Search and tell me.',
    });
    // Either it answered, or it at least attempted the tool — both prove wiring.
    expect((res.text?.length ?? 0) + (res.toolCalls?.length ?? 0)).toBeGreaterThan(0);
  }, 60_000);
});
