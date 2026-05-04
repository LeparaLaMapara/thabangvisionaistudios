# TASK-036: AI Call Timeout Guard in `trackedCompletion`
## Priority: HARDENING | Phase: Phase 0 follow-up | Depends on: —
## Files allowed: lib/ai/tracked.ts, tests/unit/tracked.test.ts

## Description
Wrap the AI call inside `trackedCompletion()` with a 30-second timeout so slow upstream providers (Anthropic, Google) cannot hold a Vercel function open until the platform kills it (60s Hobby / 300s Pro).

Failing fast gives us structured logs, a meaningful error message to the caller, and frees the connection-pool slot. Without this, a stuck provider call looks like an opaque `FUNCTION_INVOCATION_TIMEOUT` with no `ai_token_usage` row — we lose the cost signal and the audit trail.

## Context
Audit (2026-04-20) flagged this as the only non-negotiable hardening to add before scale. All other failure modes (circuit breaker, distributed rate limit, response cache, aggregate rollup) are deferred until a real signal fires. See conversation notes.

## Implementation

### lib/ai/tracked.ts
Add a `withTimeout` helper:

```ts
const AI_CALL_TIMEOUT_MS = 30_000;

class AiCallTimeoutError extends Error {
  constructor(agentId: string, model: string) {
    super(`AI call timed out after ${AI_CALL_TIMEOUT_MS}ms (${agentId} · ${model})`);
    this.name = 'AiCallTimeoutError';
  }
}

function withTimeout<T>(p: Promise<T>, agentId: string, model: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new AiCallTimeoutError(agentId, model)), AI_CALL_TIMEOUT_MS),
    ),
  ]);
}
```

Wrap the existing call site:

```ts
// before:
const { result, usage } = await params.call();

// after:
const { result, usage } = await withTimeout(params.call(), params.agentId, params.model);
```

Export `AiCallTimeoutError` so routes can return 504 when they catch it instead of 500.

### lib/agents/runtime.ts (if applicable)
`streamText` does not flow through `trackedCompletion` — it uses `logTokenUsage` after the stream finishes. Streams have their own progressive timeout model (the stream emits chunks, so Vercel does not kill it). Leave streaming alone.

### Error handling at callers
In every route that calls `trackedCompletion`, catch `AiCallTimeoutError` explicitly and return `504 Gateway Timeout` with a user-friendly message. Fall through to the generic `500` handler only for other errors.

Affected routes (audit list before implementing):
- `app/api/agents/bio-writer/route.ts`
- `app/api/agents/listing-describer/route.ts`
- `app/api/agents/portfolios/route.ts`
- `app/api/agents/onboarding/route.ts`
- `app/api/agents/rates/route.ts`
- `app/api/onboarding/create-rentals/route.ts`
- `app/api/verifications/route.ts` (face-match)

### tests/unit/tracked.test.ts (new)
- Resolves normally when `call()` finishes before timeout → returns result, inserts row.
- Rejects with `AiCallTimeoutError` when `call()` exceeds 30s (use fake timers — `vi.useFakeTimers()`).
- Does not insert a `ai_token_usage` row on timeout (nothing to log — no usage data).
- Error message includes `agentId` and `model` for log grepping.

## Acceptance criteria
- [ ] `lib/ai/tracked.ts` exports `AiCallTimeoutError` and wraps `params.call()` in 30s timeout
- [ ] All 7 affected routes catch `AiCallTimeoutError` and return 504
- [ ] New unit tests pass (`npx vitest run tests/unit/tracked.test.ts`)
- [ ] `npm run build` + `npm run test` pass
- [ ] Manual smoke: temporarily set timeout to 100ms + run an agent route → get 504, not 500

## Out of scope
- Streaming timeout (use AI SDK's `abortSignal` pattern separately if needed)
- Retry logic (separate task once we see provider 429s in production)
- Per-model timeout config (one global value until we have evidence vision calls need longer)
