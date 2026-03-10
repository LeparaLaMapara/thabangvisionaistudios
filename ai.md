# AI Abstraction Layer

## Overview

The AI system uses a **provider abstraction** pattern that allows switching between AI models (Anthropic Claude, Google Gemini, OpenAI GPT-4o) with a single environment variable. All AI interactions go through a unified interface defined in `lib/ai/`.

---

## Architecture

```
lib/ai/
  types.ts       - Shared types and AIProvider interface
  anthropic.ts   - Anthropic adapter (Claude claude-sonnet-4-20250514)
  gemini.ts      - Google Gemini adapter (gemini-1.5-pro)
  openai.ts      - OpenAI adapter (gpt-4o)
  index.ts       - Provider registry + env-based selection
```

### How Provider Selection Works

```
AI_PROVIDER env var
        |
        v
  index.ts reads env var (defaults to "anthropic")
        |
        v
  Looks up in providers registry: { anthropic, gemini, openai }
        |
        v
  Exports the matched provider as `ai`
```

All API routes import from `@/lib/ai` and call `ai.sendMessage()`. They never reference a specific provider directly.

---

## The AIProvider Interface

Every provider implements this interface (`lib/ai/types.ts`):

```typescript
interface AIProvider {
  readonly name: string;

  isConfigured(): boolean;

  sendMessage(
    systemPrompt: string,
    messages: Message[],
    options?: SendMessageOptions,
  ): Promise<SendMessageResult>;
}
```

### Key Types

| Type | Purpose |
|------|---------|
| `Message` | A conversation turn: `{ role: 'user' \| 'assistant', content: string }` |
| `MessageRole` | `'user' \| 'assistant'` |
| `SendMessageOptions` | Optional: `maxTokens` (default 4096), `temperature` (default 0.7) |
| `SendMessageResult` | Contains `response: string` - the model's text reply |

---

## How Each Provider Works

### Anthropic (`lib/ai/anthropic.ts`)

**SDK:** `@anthropic-ai/sdk`
**Model:** `claude-sonnet-4-20250514`
**Env var:** `ANTHROPIC_API_KEY`

Uses the Anthropic Messages API. The system prompt is passed via the dedicated `system` parameter (not as a message). Response text is extracted from content blocks of type `'text'`.

```typescript
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  temperature: 0.7,
  system: systemPrompt,
  messages: [{ role: 'user', content: '...' }],
});

// Response: response.content[0].text
```

**Key details:**
- System prompt is a first-class parameter, not a message
- Response may contain multiple content blocks (text, tool use, etc.) - we filter for text blocks only
- Supports `maxTokens` up to the model's context window

### Gemini (`lib/ai/gemini.ts`)

**SDK:** `@google/generative-ai`
**Model:** `gemini-1.5-pro`
**Env var:** `GEMINI_API_KEY`

Uses the Gemini Chat API with `startChat()` for conversation history support. The system prompt is set via `systemInstruction` on the model config. Messages are converted from our `user`/`assistant` roles to Gemini's `user`/`model` roles.

```typescript
const model = client.getGenerativeModel({
  model: 'gemini-1.5-pro',
  systemInstruction: systemPrompt,
  generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
});

const chat = model.startChat({ history });
const result = await chat.sendMessage(lastMessage.content);

// Response: result.response.text()
```

**Key details:**
- Gemini uses `'model'` instead of `'assistant'` for AI turns
- The adapter handles this role mapping automatically
- The last message in the array must be from `'user'` (Gemini requirement)
- System prompt is passed via `systemInstruction`, not as a message

### OpenAI (`lib/ai/openai.ts`)

**SDK:** `openai`
**Model:** `gpt-4o`
**Env var:** `OPENAI_API_KEY`

Uses the Chat Completions API. The system prompt is prepended as a `system` role message. All conversation messages follow in order.

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  max_tokens: 4096,
  temperature: 0.7,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '...' },
  ],
});

// Response: response.choices[0].message.content
```

**Key details:**
- System prompt is a message with `role: 'system'` prepended to the array
- Response is in `choices[0].message.content`
- Returns empty string if no content in the response

---

## How to Switch Providers

### Step 1: Set the environment variable

In `.env.local`:

```env
# Options: anthropic, gemini, openai
AI_PROVIDER=gemini
```

### Step 2: Add provider credentials

For **Anthropic (Claude)**:
```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

For **Gemini**:
```env
GEMINI_API_KEY=AIzaSyxxxxx
```

For **OpenAI**:
```env
OPENAI_API_KEY=sk-xxxxx
```

### Step 3: Restart the dev server

The provider is resolved at module load time. A server restart is required after changing `AI_PROVIDER`.

That's it. No code changes required.

---

## How the API Route Uses the Abstraction

### POST /api/gemini

The route accepts two usage patterns:

**Simple prompt (single message):**

```json
POST /api/gemini
{
  "prompt": "What camera should I use for a music video?"
}
```

**Conversation with history:**

```json
POST /api/gemini
{
  "prompt": "What about for outdoor shoots?",
  "systemPrompt": "You are a creative studio assistant.",
  "messages": [
    { "role": "user", "content": "What camera should I use for a music video?" },
    { "role": "assistant", "content": "For music videos, I'd recommend..." },
    { "role": "user", "content": "What about for outdoor shoots?" }
  ]
}
```

**Response:**

```json
{
  "response": "For outdoor shoots, you'll want to consider..."
}
```

**Route implementation:**

```typescript
import { ai } from '@/lib/ai';

// Check auth + rate limit (10 req/min per user)
const auth = await requireAuth();
const allowed = checkRateLimit(`ai:${auth.user.id}`, 10, 60_000);

// Check provider is configured
if (!ai.isConfigured()) {
  return NextResponse.json({ error: 'AI provider is not configured.' }, { status: 500 });
}

// Send to whichever provider is active
const result = await ai.sendMessage(systemPrompt, messageList);
return NextResponse.json({ response: result.response });
```

The route doesn't know or care which provider is active. It just calls `ai.sendMessage()`.

---

## Using the Abstraction in Your Own Code

### Basic usage (server-side only)

```typescript
import { ai } from '@/lib/ai';

const result = await ai.sendMessage(
  'You are a helpful assistant.',
  [{ role: 'user', content: 'Explain aperture in photography' }],
);

console.log(result.response);
```

### With options

```typescript
const result = await ai.sendMessage(
  'You are a concise technical writer.',
  [{ role: 'user', content: 'List 5 tips for lighting a portrait' }],
  { maxTokens: 1024, temperature: 0.3 },
);
```

### Multi-turn conversation

```typescript
const result = await ai.sendMessage(
  'You are a creative studio assistant.',
  [
    { role: 'user', content: 'I need to rent a camera for a wedding' },
    { role: 'assistant', content: 'For weddings, I recommend a full-frame mirrorless...' },
    { role: 'user', content: 'What lenses should I pair with it?' },
  ],
);
```

### Check if configured before calling

```typescript
if (ai.isConfigured()) {
  const result = await ai.sendMessage(systemPrompt, messages);
  // use result
} else {
  // fallback or error
}
```

---

## Adding a New Provider

1. Create `lib/ai/newprovider.ts` implementing the `AIProvider` interface:
   ```typescript
   import type { AIProvider, Message, SendMessageOptions, SendMessageResult } from './types';

   export const newprovider: AIProvider = {
     name: 'newprovider',
     isConfigured() { return !!process.env.NEWPROVIDER_API_KEY; },
     async sendMessage(systemPrompt, messages, options): Promise<SendMessageResult> {
       // Call the provider's API
       return { response: '...' };
     },
   };
   ```

2. Register it in `lib/ai/index.ts`:
   ```typescript
   import { newprovider } from './newprovider';

   const providers: Record<string, AIProvider> = {
     anthropic,
     gemini,
     openai,
     newprovider,
   };
   ```

3. Set `AI_PROVIDER=newprovider` in `.env.local`

---

## Provider Comparison

| Feature | Anthropic (Claude) | Gemini | OpenAI (GPT-4o) |
|---------|-------------------|--------|-----------------|
| Model | claude-sonnet-4-20250514 | gemini-1.5-pro | gpt-4o |
| SDK | @anthropic-ai/sdk | @google/generative-ai | openai |
| System prompt | Dedicated `system` param | `systemInstruction` config | `system` role message |
| AI role name | `assistant` | `model` (mapped automatically) | `assistant` |
| Response format | Content blocks array | `.response.text()` | `choices[0].message.content` |
| Default max tokens | 4096 | 4096 | 4096 |
| Default temperature | 0.7 | 0.7 | 0.7 |

---

## Security

- All API keys are server-side only (no `NEXT_PUBLIC_` prefix)
- The `/api/gemini` route requires authentication (`requireAuth()`)
- Rate limited to 10 requests per minute per user
- Provider errors return a generic 502 message - no internal details leak to the client
- API keys are read lazily (on first call), not at import time

---

## Where to Get Credentials

### Anthropic (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up and add billing
3. Navigate to **API Keys** in the left sidebar
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-`)

```env
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### Google Gemini

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API key** in the left sidebar
4. Create a key for a new or existing Google Cloud project
5. Copy the key (starts with `AIzaSy`)

```env
GEMINI_API_KEY=AIzaSyxxxxx
```

### OpenAI (GPT-4o)

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up and add billing
3. Navigate to **API keys** under your profile
4. Click **Create new secret key**
5. Copy the key (starts with `sk-`)

```env
OPENAI_API_KEY=sk-xxxxx
```

### General

```env
# Which provider to use (default: anthropic)
AI_PROVIDER=anthropic
```

---

## Files Modified by This Abstraction

| File | Change |
|------|--------|
| `lib/ai/types.ts` | Created - shared interface and types |
| `lib/ai/anthropic.ts` | Created - Claude adapter using @anthropic-ai/sdk |
| `lib/ai/gemini.ts` | Created - Gemini adapter using @google/generative-ai |
| `lib/ai/openai.ts` | Created - GPT-4o adapter using openai SDK |
| `lib/ai/index.ts` | Created - provider registry and env-based selection |
| `app/api/gemini/route.ts` | Updated - uses `ai.sendMessage()` instead of direct Gemini fetch |
| `package.json` | Updated - added @anthropic-ai/sdk, @google/generative-ai, openai |
| `.env.local` | Updated - added `AI_PROVIDER` variable |
