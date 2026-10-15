import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * With roles_v1 off, every roles API route answers 404 before it reads any
 * roles table, so main can ship this code before production has migration 090.
 */

const tableReads: string[] = [];

vi.mock('@/lib/features', () => ({ getFlag: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => {
      tableReads.push(t);
      throw new Error(`read ${t}`);
    },
  };
  return { createClient: async () => client, createAdminClient: () => client };
});

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/roles/x', { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } });
const ctx = { params: Promise.resolve({ slug: 'makeup-artist' }) };

describe('roles API with roles_v1 off', () => {
  beforeEach(() => {
    tableReads.length = 0;
  });

  it('every handler answers 404 and reads no table', async () => {
    const interest = await import('@/app/api/roles/interest/route');
    const match = await import('@/app/api/roles/match/route');
    const draft = await import('@/app/api/roles/[slug]/route');
    const evidence = await import('@/app/api/roles/[slug]/evidence/route');
    const document = await import('@/app/api/roles/[slug]/document/route');
    const admin = await import('@/app/api/admin/roles/route');
    const face = await import('@/app/api/roles/face/route');
    const intake = await import('@/app/api/roles/intake/route');
    const offer = await import('@/app/api/roles/offer/route');
    const requests = await import('@/app/api/roles/requests/route');
    const adminMatch = await import('@/app/api/admin/roles/match/route');
    const reembed = await import('@/app/api/admin/roles/reembed/route');

    const results = await Promise.all([
      interest.POST(req('POST', { role_slug: 'gaffer', phone: '0721234567' })),
      match.POST(req('POST', { text: 'make-up' })),
      draft.GET(req('GET'), ctx),
      draft.PUT(req('PUT', {}), ctx),
      draft.POST(req('POST', { action: 'submit' }), ctx),
      evidence.POST(req('POST', {}), ctx),
      evidence.DELETE(req('DELETE'), ctx),
      document.POST(req('POST', {}), ctx),
      admin.GET(req('GET')),
      admin.PATCH(req('PATCH', {})),
      face.GET(),
      face.POST(req('POST', { action: 'upload' })),
      intake.POST(req('POST', { action: 'analyze', text: 'make-up' })),
      offer.POST(req('POST', { role_slug: 'model' })),
      requests.POST(req('POST', {})),
      adminMatch.GET(req('GET')),
      reembed.POST(),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(17).fill(404));
    expect(tableReads).toEqual([]);
  }, 30_000); // imports many route modules; slow under a full parallel run
});
