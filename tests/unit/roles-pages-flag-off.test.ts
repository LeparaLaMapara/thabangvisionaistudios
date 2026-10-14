import { describe, it, expect, vi } from 'vitest';

/**
 * With roles_v1 off every People page is a 404 before it reads anything, so
 * a release without migrations 090 and 091 changes nothing for visitors.
 */

const tableReads: string[] = [];

vi.mock('@/lib/features', () => ({ getFlag: vi.fn(async () => false), getFlags: vi.fn(async () => ({})) }));
// The photo helpers load a HEIC decoder that is not needed here.
vi.mock('@/lib/verification/prepare-photo', () => ({ preparePhoto: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
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

describe('People pages with roles_v1 off', () => {
  it('each page throws notFound and reads no table', async () => {
    const pages: [string, () => Promise<unknown>][] = [
      ['people', async () => (await import('@/app/(platform)/people/page')).default({ searchParams: Promise.resolve({}) })],
      ['people/[id]', async () => (await import('@/app/(platform)/people/[id]/page')).default({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) })],
      ['people/[id]/request', async () => (await import('@/app/(platform)/people/[id]/request/page')).default({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) })],
      ['people/requests/[rid]', async () => (await import('@/app/(platform)/people/requests/[rid]/page')).default({ params: Promise.resolve({ rid: '00000000-0000-4000-8000-000000000001' }) })],
      ['offer', async () => (await import('@/app/(platform)/offer/page')).default({ searchParams: Promise.resolve({}) })],
      ['offer/preview', async () => (await import('@/app/(platform)/offer/preview/page')).default({ searchParams: Promise.resolve({ role: 'model' }) })],
      ['offer/guidelines', async () => (await import('@/app/(platform)/offer/guidelines/page')).default()],
    ];
    for (const [name, run] of pages) {
      await expect(run(), name).rejects.toThrow('NOT_FOUND');
    }
    expect(tableReads).toEqual([]);
  });
});
