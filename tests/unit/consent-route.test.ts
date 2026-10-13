import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mocks: session client and rate limiter ─────────────────────────────────

const state: {
  user: { id: string } | null;
  inserted: Record<string, unknown>[];
  insertError: { code?: string; message: string } | null;
  allow: boolean;
} = { user: null, inserted: [], insertError: null, allow: true };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        if (state.insertError) return { error: state.insertError };
        state.inserted.push(...rows);
        return { error: null };
      },
    }),
  }),
}));

vi.mock('@/lib/auth', () => ({
  checkRateLimit: async () => state.allow,
}));

const { POST } = await import('@/app/api/consent/route');

function post(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '41.0.0.1', 'user-agent': 'vitest' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.inserted = [];
  state.insertError = null;
  state.allow = true;
});

describe('POST /api/consent', () => {
  it('401 for a signed-out caller', async () => {
    state.user = null;
    const res = await POST(post({ purposes: ['terms'], source: 'signup' }));
    expect(res.status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  it('records the current versions for the signed-in user (never a user id from the body)', async () => {
    const res = await POST(post({ purposes: ['terms', 'privacy'], source: 'oauth_onboarding' }));
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted.every((r) => r.user_id === 'user-1')).toBe(true);
    expect(state.inserted.every((r) => r.source === 'oauth_onboarding')).toBe(true);
  });

  it('400 when the body carries anything beyond purposes and source', async () => {
    const res = await POST(post({ purposes: ['terms'], source: 'signup', user_id: 'someone-else' }));
    expect(res.status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });

  it('400 for a purpose not accepted from that source', async () => {
    const res = await POST(post({ purposes: ['biometric'], source: 'checkout' }));
    expect(res.status).toBe(400);
  });

  it('400 for invalid JSON', async () => {
    const res = await POST(post('{not json', true));
    expect(res.status).toBe(400);
  });

  it('429 when rate limited', async () => {
    state.allow = false;
    const res = await POST(post({ purposes: ['terms'], source: 'signup' }));
    expect(res.status).toBe(429);
    expect(state.inserted).toHaveLength(0);
  });

  it('503 when the consent table is missing (migration 068 not applied)', async () => {
    state.insertError = { code: '42P01', message: 'relation "public.consent_records" does not exist' };
    const res = await POST(post({ purposes: ['terms'], source: 'signup' }));
    expect(res.status).toBe(503);
  });

  it('500 (no detail leaked) when the insert is refused', async () => {
    state.insertError = { code: '42501', message: 'new row violates row-level security policy' };
    const res = await POST(post({ purposes: ['terms'], source: 'signup' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('row-level');
  });
});
