import { describe, it, expect } from 'vitest';
import { clientIp } from '@/lib/http/clientIp';

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '41.0.0.1, 10.0.0.2, 10.0.0.3' }))).toBe('41.0.0.1');
  });

  it('trims whitespace around the hop', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '  41.0.0.1  , 10.0.0.2' }))).toBe('41.0.0.1');
  });

  it('does not let a caller rotate buckets by appending entries', () => {
    // The bypass this fixes: the old code keyed on the whole header, so every
    // distinct trailing value was a fresh rate-limit bucket. The first hop is
    // stable regardless of what the caller appends.
    const a = clientIp(headers({ 'x-forwarded-for': '41.0.0.1, spoof-A' }));
    const b = clientIp(headers({ 'x-forwarded-for': '41.0.0.1, spoof-B' }));
    expect(a).toBe(b);
  });

  it('falls back to x-real-ip when forwarded-for is absent', () => {
    expect(clientIp(headers({ 'x-real-ip': '41.0.0.9' }))).toBe('41.0.0.9');
  });

  it('collapses to a shared bucket when no header is present, never exempting', () => {
    // A missing header must not become a unique key per request — that would
    // exempt the caller from the limit entirely.
    expect(clientIp(headers({}))).toBe('unknown');
  });

  it('ignores an empty forwarded-for and uses the fallback', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '', 'x-real-ip': '41.0.0.5' }))).toBe('41.0.0.5');
  });
});
