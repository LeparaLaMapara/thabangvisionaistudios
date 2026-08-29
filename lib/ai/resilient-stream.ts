import { streamText, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { LanguageModel, UIMessageChunk } from 'ai';
import { APICallError } from 'ai';
import { resolveEntry, buildModel, fallbackChain, type ModelEntry } from './registry';

/**
 * Whether to try the NEXT provider after this error.
 *
 * Deliberately more permissive than same-provider retry. A missing key or a
 * model-not-found on provider A says nothing about provider B, so those DO earn
 * a failover even though retrying A would be pointless. The only thing not worth
 * failing over is a genuine bad request (400): a malformed prompt fails
 * identically everywhere, so trying the next provider just delays the real
 * error.
 */
function shouldFailover(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    const s = err.statusCode ?? 0;
    return s !== 400; // everything except a malformed request
  }
  return true; // config error, network, timeout, unknown: a different provider may work
}

/**
 * Streaming completion with provider failover — before the first token.
 *
 * The chat runtime streams from a single model. When that provider rate-limits
 * or blips, the error lands inside the stream, the route's try/catch never sees
 * it, and the customer gets "connectivity issues". A rate limit should not take
 * chat down.
 *
 * Failing over a stream is only safe BEFORE any content has been sent — you
 * cannot un-send half a reply. So this holds the opening parts (the `start`
 * chunk and friends) in a buffer and commits to a provider only once it emits
 * real content: a text delta or a tool call. If the provider errors before
 * that — which is exactly how a rate limit or a dead endpoint fails — the buffer
 * is discarded and the next provider is tried, with nothing leaked to the
 * client. Once a provider has produced content, we are committed to it and its
 * stream is forwarded to the end.
 *
 * The transported unit is the SDK's own UIMessageChunk, so there is no
 * hand-rolled format mapping to drift out of sync with the SDK.
 */

/** UIMessageChunk types that count as real content — the point of no return. */
function isContent(chunk: UIMessageChunk): boolean {
  const t = chunk.type;
  return t === 'text-delta'
    || t === 'text-start'
    || t === 'reasoning-delta'
    || t.startsWith('tool-');
}

export interface StreamFallbackParams {
  /** First model to try; a tier/provider/pair ref. The chain follows. */
  ref?: string;
  system?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stopWhen?: any;
  maxOutputTokens?: number;
  /** Called once, with the entry that actually served the response. */
  onServed?: (entry: ModelEntry, failovers: number) => void;
  /** streamText onFinish, attached only to the committed provider's stream. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: any) => void;
}

/** The ordered entries to try: the requested model, then the rest of the chain. */
function streamOrder(ref: string | undefined): ModelEntry[] {
  const first = resolveEntry(ref);
  const rest = fallbackChain()
    .filter((p) => p !== first.provider)
    .map((p) => resolveEntry(p))
    // A streaming assistant turn carries tools; never fail over onto a model
    // that cannot call them, or bookings silently break.
    .filter((e) => e.tools);
  return [first, ...rest];
}

export function streamWithFallback(params: StreamFallbackParams): Response {
  const order = streamOrder(params.ref);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let lastError: unknown;

      for (let i = 0; i < order.length; i++) {
        const entry = order[i];
        const isLast = i === order.length - 1;
        let model: LanguageModel;
        try {
          model = buildModel(entry);
        } catch (err) {
          lastError = err;
          continue;
        }

        // The caller always supplies messages; the optional spreads and the
        // heterogeneous tool/stop types make the literal awkward to type, so
        // the argument object is assembled and passed as the SDK's input type.
        const streamArgs = {
          model,
          messages: params.messages,
          tools: params.tools,
          ...(params.system ? { system: params.system } : {}),
          ...(params.stopWhen ? { stopWhen: params.stopWhen } : {}),
          ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
          // onFinish only matters for the provider we commit to; a failed
          // attempt never reaches a finish.
          ...(params.onFinish ? { onFinish: params.onFinish } : {}),
        } as Parameters<typeof streamText>[0];
        const result = streamText(streamArgs);

        const reader = result.toUIMessageStream().getReader();
        const buffered: UIMessageChunk[] = [];
        let committed = false;
        let failed = false;

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value.type === 'error' && !committed) {
              // Errored before producing content: safe to try the next
              // provider, since nothing content-bearing was forwarded.
              failed = true;
              lastError = new Error(String((value as { errorText?: string }).errorText ?? 'stream error'));
              break;
            }

            if (committed) {
              writer.write(value);
              continue;
            }

            // Not yet committed: hold the opening parts, and commit the moment
            // real content appears — then flush what we held.
            buffered.push(value);
            if (isContent(value)) {
              committed = true;
              // Announce the served model at commit, BEFORE the provider's own
              // onFinish fires at stream end, so cost logging records the model
              // that actually answered rather than the one first routed to.
              params.onServed?.(entry, i);
              for (const c of buffered) writer.write(c);
              buffered.length = 0;
            }
          }
        } catch (err) {
          if (!committed) {
            failed = true;
            lastError = err;
          } else {
            // A mid-stream failure after content: cannot fail over cleanly, so
            // surface it on this stream rather than duplicating a reply.
            throw err;
          }
        } finally {
          reader.releaseLock();
        }

        if (!failed) {
          // Committed streams already announced via onServed. A clean finish
          // with no content (rare empty completion) never committed; nothing
          // was sent, so just return.
          return;
        }
        if (isLast || !shouldFailover(lastError)) break;
        // else: try the next provider.
      }

      throw new Error(
        `[ai] all streaming providers failed — ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    },
    onError: (err) =>
      err instanceof Error ? err.message : 'The assistant is briefly unavailable. Please try again.',
  });

  return createUIMessageStreamResponse({ stream });
}
