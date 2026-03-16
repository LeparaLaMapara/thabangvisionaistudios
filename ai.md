# AI Abstraction Layer

## Overview

The AI system uses the **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) with a thin wrapper in `lib/ai/index.ts`. Switching providers requires only changing the `AI_PROVIDER` environment variable.

---

## Architecture

```
lib/ai/
  index.ts       - getModel() — returns the active LanguageModel based on AI_PROVIDER env var
```

### How Provider Selection Works

```
AI_PROVIDER env var (default: "anthropic")
        |
        v
  getModel() in index.ts
        |
        v
  Returns: anthropic('claude-sonnet-4-20250514') | openai('gpt-4o') | google('gemini-2.0-flash')
```

API routes import `getModel()` from `@/lib/ai` and pass it to Vercel AI SDK functions like `streamText()` or `generateText()`.

---

## lib/ai/index.ts

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export function getModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();

  switch (provider) {
    case 'anthropic':
      return anthropic('claude-sonnet-4-20250514');
    case 'openai':
      return openai('gpt-4o');
    case 'gemini':
      return google('gemini-2.0-flash');
    default:
      return anthropic('claude-sonnet-4-20250514');
  }
}
```

---

## API Routes

### POST /api/ubunye-chat (Streaming)

The primary chat route uses `streamText()` from the Vercel AI SDK. Messages from the frontend arrive in `UIMessage` format (with `parts` array), so they must be converted to `ModelMessage` format before passing to `streamText()`:

```typescript
import { streamText, convertToModelMessages } from 'ai';
import { getModel } from '@/lib/ai';

// UIMessage[] (from useChat) → ModelMessage[] (for streamText)
const isUIFormat = rawMessages.some(m => Array.isArray(m.parts));
const modelMessages = isUIFormat
  ? await convertToModelMessages(rawMessages)
  : rawMessages;

const result = streamText({
  model: getModel(),
  system: systemPrompt,
  messages: modelMessages,
});

return result.toUIMessageStreamResponse();
```

**Important:** `convertToModelMessages()` is async — it must be awaited. The route auto-detects the format: `UIMessage` (from frontend, has `parts`) vs `CoreMessage` (from curl, has `content`).

### POST /api/gemini (Non-streaming fallback)

Uses `generateText()` for simple request/response:

```typescript
import { generateText } from 'ai';
import { getModel } from '@/lib/ai';

const result = await generateText({
  model: getModel(),
  system: systemPrompt,
  messages: messageList,
});

return NextResponse.json({ response: result.text });
```

---

## Frontend (useChat)

The Ubunye chat page uses `useChat` from `@ai-sdk/react`:

```typescript
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

const transport = new DefaultChatTransport({
  api: '/api/ubunye-chat',
  body: () => ({ sessionMessageCount, isFirstGuestMessage }),
});

const { messages, sendMessage, status, error } = useChat({ transport });
```

This provides streaming, loading state, message history, and error handling out of the box.

---

## How to Switch Providers

### Step 1: Set the environment variable

In `.env.local`:

```env
# Options: anthropic, gemini, openai
AI_PROVIDER=gemini
```

### Step 2: Add provider credentials

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Gemini
GEMINI_API_KEY=AIzaSyxxxxx

# OpenAI
OPENAI_API_KEY=sk-xxxxx
```

### Step 3: Restart the dev server

The provider is resolved at call time via `getModel()`. A server restart picks up the new env var.

---

## Provider Comparison

| Feature | Anthropic (Claude) | Gemini | OpenAI (GPT-4o) |
|---------|-------------------|--------|-----------------|
| Model | claude-sonnet-4-20250514 | gemini-2.0-flash | gpt-4o |
| SDK | @ai-sdk/anthropic | @ai-sdk/google | @ai-sdk/openai |
| Env var | ANTHROPIC_API_KEY | GEMINI_API_KEY | OPENAI_API_KEY |

All provider differences (system prompt format, role mapping, response extraction) are handled internally by the Vercel AI SDK adapters.

---

## Packages

| Package | Purpose |
|---------|---------|
| `ai` | Core Vercel AI SDK (`streamText`, `generateText`, `LanguageModel` type) |
| `@ai-sdk/anthropic` | Anthropic provider adapter |
| `@ai-sdk/openai` | OpenAI provider adapter |
| `@ai-sdk/google` | Google Gemini provider adapter |
| `@ai-sdk/react` | React hooks (`useChat`, `useCompletion`) |

---

## Security

- All API keys are server-side only (no `NEXT_PUBLIC_` prefix)
- `/api/ubunye-chat` and `/api/gemini` require authentication or enforce guest limits
- Rate limited to 10 requests per minute per user
- Provider errors return a generic 502 message — no internal details leak to the client

---

## RAG Embeddings (Separate)

The RAG system in `lib/rag/embeddings/` uses native SDKs (`@google/generative-ai`, `openai`) directly for embedding generation. This is intentional — the Vercel AI SDK is used only for chat/text generation.

---

## Files

| File | Purpose |
|------|---------|
| `lib/ai/index.ts` | `getModel()` — thin wrapper returning Vercel AI SDK LanguageModel |
| `app/api/ubunye-chat/route.ts` | Streaming chat endpoint using `streamText()` |
| `app/api/gemini/route.ts` | Non-streaming fallback using `generateText()` |
| `app/(immersive)/ubunye-ai-studio/page.tsx` | Chat UI using `useChat()` from `@ai-sdk/react` |
