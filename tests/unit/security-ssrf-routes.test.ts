/**
 * Phase 6 security INJ-2 (portfolio analyser, any signed-in user) and INJ-4
 * (admin EXIF reader): the routes must refuse URLs that would make the server
 * request an internal address, before anything is fetched.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const analyzeScene = vi.fn(async () => ({ sceneType: 'portrait', lightingSetup: 'natural', qualityScore: 5, description: '', hashtags: [] }));
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ error: null, user: { id: 'u1' } }),
  requireAdmin: async () => ({ error: null, user: { id: 'admin1' } }),
  rateLimitAdmin: async () => null,
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/agents/tools', () => ({ analyzeScene, detectSkills: vi.fn() }));
vi.mock('@/app/api/listings/_lib/images', () => ({
  isOwnImageUrl: (url: string) => url.startsWith('https://res.cloudinary.com/our-cloud/image/upload/'),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
  createAdminClient: () => ({}),
}));

const portfolios = await import('@/app/api/agents/portfolios/route');
const extract = await import('@/app/api/admin/extract-metadata/route');

const analyze = (imageUrls: unknown[]) =>
  portfolios.POST(
    new NextRequest('http://localhost/api/agents/portfolios', {
      method: 'POST',
      body: JSON.stringify({ action: 'analyze-portfolio', imageUrls }),
    }),
  );

const OWN = 'https://res.cloudinary.com/our-cloud/image/upload/v1/p/a.jpg';

describe('POST /api/agents/portfolios only fetches our own uploads (INJ-2)', () => {
  beforeEach(() => analyzeScene.mockClear());

  it.each([
    'http://127.0.0.1:47731/ssrf-INTERNAL-REACHED',
    'http://169.254.169.254/latest/meta-data/',
    'https://evil.example/a.jpg',
    'http://res.cloudinary.com/our-cloud/image/upload/a.jpg',
    'https://res.cloudinary.com/other/image/upload/a.jpg',
  ])('refuses %s (even mixed with a good one) without fetching anything', async (bad) => {
    const res = await analyze([OWN, bad]);
    expect(res.status).toBe(400);
    expect(analyzeScene).not.toHaveBeenCalled();
  });

  it('refuses too many images at once', async () => {
    const res = await analyze(Array(50).fill(OWN));
    expect(res.status).toBe(400);
    expect(analyzeScene).not.toHaveBeenCalled();
  });

  it('analyses our own uploads', async () => {
    const res = await analyze([OWN, OWN]);
    expect(res.status).toBe(200);
    expect(analyzeScene).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/admin/extract-metadata never fetches internal addresses (INJ-4)', () => {
  const realFetch = globalThis.fetch;
  const fetchSpy = vi.fn(async () => new Response('x'));
  beforeEach(() => {
    fetchSpy.mockClear();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it.each([
    'http://127.0.0.1:3000/',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/',
    'https://[::1]/',
  ])('returns no metadata for %s and does not fetch it', async (url) => {
    const res = await extract.POST(
      new NextRequest('http://localhost/api/admin/extract-metadata', { method: 'POST', body: JSON.stringify({ imageUrl: url }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an oversized URL list', async () => {
    const res = await extract.POST(
      new NextRequest('http://localhost/api/admin/extract-metadata', {
        method: 'POST',
        body: JSON.stringify({ imageUrls: Array(21).fill('https://res.cloudinary.com/x.jpg') }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
