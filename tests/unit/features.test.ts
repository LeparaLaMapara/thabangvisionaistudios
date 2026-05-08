import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterNavSync } from '@/lib/nav';
import { FEATURE_KEYS, isFeatureKey } from '@/lib/features';

// ─── isFeatureKey / FEATURE_KEYS ────────────────────────────────────────────

describe('FEATURE_KEYS', () => {
  it('is a non-empty readonly tuple', () => {
    expect(FEATURE_KEYS.length).toBeGreaterThan(0);
  });

  it('contains the flags Smart Productions depends on', () => {
    expect(FEATURE_KEYS).toContain('smart_productions');
    expect(FEATURE_KEYS).toContain('smart_productions_booking');
  });

  it('isFeatureKey accepts known keys and rejects unknown ones', () => {
    expect(isFeatureKey('smart_productions')).toBe(true);
    expect(isFeatureKey('totally_made_up')).toBe(false);
    expect(isFeatureKey('')).toBe(false);
  });
});

// ─── filterNavSync ──────────────────────────────────────────────────────────

describe('filterNavSync', () => {
  const nav = [
    { label: 'Smart Rentals', href: '/smart-rentals' },
    { label: 'Smart Productions', href: '/smart-production' },
    { label: 'Pricing', href: '/pricing' },
  ];

  it('hides /smart-production entries when smart_productions is off', () => {
    const result = filterNavSync(nav, {
      smart_productions: false,
      smart_productions_booking: false,
      studio_crews: false,
      voice_onboarding: false,
      ai_rate_suggestions: false,
      ai_portfolio_tagging: false,
    });
    expect(result.map((i) => i.href)).toEqual(['/smart-rentals', '/pricing']);
  });

  it('keeps /smart-production entries when smart_productions is on', () => {
    const result = filterNavSync(nav, {
      smart_productions: true,
      smart_productions_booking: false,
      studio_crews: false,
      voice_onboarding: false,
      ai_rate_suggestions: false,
      ai_portfolio_tagging: false,
    });
    expect(result.map((i) => i.href)).toEqual([
      '/smart-rentals',
      '/smart-production',
      '/pricing',
    ]);
  });

  it('also hides nested /smart-production/* hrefs', () => {
    const nested = [
      { href: '/smart-rentals' },
      { href: '/smart-production/category/film' },
      { href: '/smart-productionXXX' },
    ];
    const result = filterNavSync(nested, {
      smart_productions: false,
      smart_productions_booking: false,
      studio_crews: false,
      voice_onboarding: false,
      ai_rate_suggestions: false,
      ai_portfolio_tagging: false,
    });
    expect(result.map((i) => i.href)).toEqual([
      '/smart-rentals',
      '/smart-productionXXX',
    ]);
  });

  it('is a pure function — does not mutate the input', () => {
    const original = [...nav];
    filterNavSync(nav, {
      smart_productions: false,
      smart_productions_booking: false,
      studio_crews: false,
      voice_onboarding: false,
      ai_rate_suggestions: false,
      ai_portfolio_tagging: false,
    });
    expect(nav).toEqual(original);
  });
});

// ─── getFlag fail-closed behaviour ──────────────────────────────────────────

describe('getFlag fail-closed', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns false when the DB read fails (flag without custom default)', async () => {
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
      revalidateTag: vi.fn(),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    }));

    const { getFlag } = await import('@/lib/features');
    expect(await getFlag('studio_crews')).toBe(false);
  });

  it('returns FLAG_DEFAULTS when the DB read fails (flag with custom default)', async () => {
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
      revalidateTag: vi.fn(),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    }));

    const { getFlag } = await import('@/lib/features');
    expect(await getFlag('smart_productions')).toBe(true);
  });

  it('returns false when the flag row is missing (flag without custom default)', async () => {
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
      revalidateTag: vi.fn(),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }));

    const { getFlag } = await import('@/lib/features');
    expect(await getFlag('studio_crews')).toBe(false);
  });

  it('returns the persisted value when the flag is enabled', async () => {
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
      revalidateTag: vi.fn(),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({
              data: [{ key: 'smart_productions', enabled: true, description: null, updated_at: '', updated_by: null }],
              error: null,
            }),
          }),
        }),
      }),
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            order: () => Promise.resolve({
              data: [{ key: 'smart_productions', enabled: true, description: null, updated_at: '', updated_by: null }],
              error: null,
            }),
          }),
        }),
      }),
    }));

    const { getFlag } = await import('@/lib/features');
    expect(await getFlag('smart_productions')).toBe(true);
  });
});
