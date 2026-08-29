import { describe, it, expect } from 'vitest';
import { isRetryable } from '@/lib/ai/resilient';
import { APICallError } from 'ai';

function apiError(opts: { statusCode?: number; isRetryable?: boolean }): APICallError {
  return new APICallError({
    message: 'x',
    url: 'https://api',
    requestBodyValues: {},
    statusCode: opts.statusCode,
    isRetryable: opts.isRetryable ?? false,
  });
}

describe('isRetryable — what earns a failover', () => {
  it('retries on a rate limit (429)', () => {
    expect(isRetryable(apiError({ statusCode: 429 }))).toBe(true);
  });

  it('retries on a provider 5xx', () => {
    expect(isRetryable(apiError({ statusCode: 503 }))).toBe(true);
  });

  it('retries when the SDK itself marks the error retryable', () => {
    expect(isRetryable(apiError({ statusCode: 400, isRetryable: true }))).toBe(true);
  });

  it('does NOT retry a plain bad request', () => {
    // A 400 fails identically on every provider; failing over just burns the
    // chain and delays the real error.
    expect(isRetryable(apiError({ statusCode: 400 }))).toBe(false);
  });

  it('does NOT retry an auth failure', () => {
    expect(isRetryable(apiError({ statusCode: 401 }))).toBe(false);
  });

  it('retries our own timeout (AbortError)', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(isRetryable(e)).toBe(true);
  });

  it('retries a network-shaped error', () => {
    expect(isRetryable(new Error('fetch failed: ECONNRESET'))).toBe(true);
  });

  it('does not retry an ordinary error it cannot classify', () => {
    expect(isRetryable(new Error('the model refused to answer'))).toBe(false);
  });

  it('does not throw on a non-error value', () => {
    expect(isRetryable('nope')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});
