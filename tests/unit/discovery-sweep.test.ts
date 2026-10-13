import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));

import { changedPaths, runDiscoverySweep } from '@/lib/discovery/sweep';
import { fixtureCatalog } from './helpers/discovery-catalog';

const NOW = new Date('2026-10-13T08:00:00.000Z');

describe('the daily discovery sweep', () => {
  it('picks pages whose real last change is within the last day, newest first', () => {
    const paths = changedPaths(fixtureCatalog(), NOW);
    expect(paths).toContain('/rentals/cameras-optics/sony-fx3');
    // Newest first: changed this morning before changed yesterday.
    expect(paths.indexOf('/rentals/cameras-optics/sony-fx3')).toBeLessThan(paths.indexOf('/studio/headshots'));
    expect(paths).toContain('/rentals');
    expect(paths).toContain('/rentals/cameras-optics');
    expect(paths).toContain('/studio/headshots');
    // Changed weeks ago, or no known date: left alone.
    expect(paths).not.toContain('/rentals/audio/rode-ntg');
    expect(paths).not.toContain('/press/launch');
    expect(paths).not.toContain('/faq');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('is capped', () => {
    expect(changedPaths(fixtureCatalog(), NOW, 24 * 3600_000, 2)).toHaveLength(2);
  });

  it('pings what changed and reports it', async () => {
    const ping = vi.fn(async (p: readonly string[]) => ({ sent: p.length, status: 200 }));
    const res = await runDiscoverySweep(NOW, { read: async () => fixtureCatalog(), ping });
    expect(ping).toHaveBeenCalledTimes(1);
    expect(res.changed).toBe(ping.mock.calls[0][0].length);
  });

  it('never throws when the catalogue cannot be read', async () => {
    const res = await runDiscoverySweep(NOW, {
      read: async () => {
        throw new Error('db down');
      },
      ping: vi.fn(),
    });
    expect(res).toEqual({ changed: 0, result: { error: 'db down' } });
  });
});
