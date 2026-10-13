import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));

import { STUDIO } from '@/lib/constants';
import {
  INDEXNOW_ENDPOINT,
  indexableUrls,
  isValidIndexNowKey,
  notifyDiscovery,
  pingIndexNow,
  resetDiscoveryQueue,
  type NotifyDeps,
} from '@/lib/discovery/notify';
import { discoveryRoute } from '@/lib/discovery/proxy-rewrite';
import { GET as keyRoute } from '@/app/indexnow-key/route';

const KEY = 'a1b2c3d4e5f6a7b8';
const PROD = { key: KEY, vercelEnv: 'production' };

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response('', { status: 200 }));
}

describe('indexableUrls', () => {
  it('keeps indexable pages on our host, dedupes, and makes them absolute', () => {
    const urls = indexableUrls([
      '/rentals/cameras-optics/sony-fx3',
      '/rentals/cameras-optics/sony-fx3/',
      `${STUDIO.meta.url}/rentals/cameras-optics/sony-fx3`,
      'https://thabangvision.com/press/launch',
      '/login',
      '/dashboard/listings',
      '/api/og',
      'https://evil.example/rentals/a/b',
      '',
    ]);
    expect(urls).toEqual([`${STUDIO.meta.url}/rentals/cameras-optics/sony-fx3`, `${STUDIO.meta.url}/press/launch`]);
  });
});

describe('pingIndexNow', () => {
  it('only pings in production', async () => {
    const f = okFetch();
    expect(await pingIndexNow(['/faq'], { key: KEY, vercelEnv: 'preview' }, f)).toMatchObject({ skipped: 'not-production' });
    expect(await pingIndexNow(['/faq'], { key: KEY, vercelEnv: undefined }, f)).toMatchObject({ skipped: 'not-production' });
    expect(f).not.toHaveBeenCalled();
  });

  it('skips without a key or with a malformed one', async () => {
    const f = okFetch();
    expect(await pingIndexNow(['/faq'], { vercelEnv: 'production' }, f)).toMatchObject({ skipped: 'no-key' });
    expect(await pingIndexNow(['/faq'], { key: 'short', vercelEnv: 'production' }, f)).toMatchObject({ skipped: 'bad-key' });
    expect(await pingIndexNow(['/login'], PROD, f)).toMatchObject({ skipped: 'nothing-to-send' });
    expect(f).not.toHaveBeenCalled();
  });

  it('sends one batched IndexNow request with host, key, key location and the URLs', async () => {
    const f = okFetch();
    const res = await pingIndexNow(['/faq', '/faq', '/press/launch'], PROD, f);
    expect(res).toEqual({ sent: 2, status: 200 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    const body = JSON.parse(String(init?.body));
    expect(body.host).toBe(new URL(STUDIO.meta.url).host);
    expect(body.key).toBe(KEY);
    expect(body.keyLocation).toBe(`${STUDIO.meta.url}/${KEY}.txt`);
    expect(body.urlList).toEqual([`${STUDIO.meta.url}/faq`, `${STUDIO.meta.url}/press/launch`]);
  });

  it('never throws: network errors and bad answers come back as results', async () => {
    const boom = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(pingIndexNow(['/faq'], PROD, boom)).resolves.toMatchObject({ skipped: 'failed', error: 'network down' });
    const bad = vi.fn(async () => new Response('', { status: 422 }));
    await expect(pingIndexNow(['/faq'], PROD, bad)).resolves.toMatchObject({ skipped: 'failed', error: 'HTTP 422' });
  });

  it('validates keys like IndexNow does', () => {
    expect(isValidIndexNowKey(KEY)).toBe(true);
    expect(isValidIndexNowKey('has space in it')).toBe(false);
    expect(isValidIndexNowKey('x'.repeat(129))).toBe(false);
  });
});

describe('notifyDiscovery', () => {
  afterEach(() => resetDiscoveryQueue());

  function deps(): NotifyDeps & { tasks: (() => Promise<void>)[]; pinged: string[][] } {
    const tasks: (() => Promise<void>)[] = [];
    const pinged: string[][] = [];
    return {
      tasks,
      pinged,
      revalidate: vi.fn(),
      schedule: (t) => tasks.push(t),
      ping: async (paths) => {
        pinged.push([...paths]);
        return { sent: paths.length, status: 200 };
      },
    };
  }

  it('revalidates at once, then batches every change of the request into one ping', async () => {
    const d = deps();
    notifyDiscovery(['/rentals/audio/rode-ntg', '/rentals'], d);
    notifyDiscovery(['/rentals', '/press/launch'], d);
    notifyDiscovery(async () => ['/faq', '/press/launch'], d);
    expect(d.revalidate).toHaveBeenCalledTimes(3);
    expect(d.tasks).toHaveLength(1);
    await d.tasks[0]();
    expect(d.pinged).toHaveLength(1);
    expect(d.pinged[0].sort()).toEqual(['/faq', '/press/launch', '/rentals', '/rentals/audio/rode-ntg']);
  });

  it('never throws, even when revalidation, scheduling or resolving fails', async () => {
    const d = deps();
    d.revalidate = () => {
      throw new Error('outside a request');
    };
    expect(() => notifyDiscovery(['/faq'], d)).not.toThrow();
    const broken: NotifyDeps = { ...d, schedule: () => { throw new Error('no after'); } };
    resetDiscoveryQueue();
    expect(() => notifyDiscovery(['/faq'], broken)).not.toThrow();
    resetDiscoveryQueue();
    notifyDiscovery(async () => { throw new Error('db down'); }, d);
    await expect(d.tasks[d.tasks.length - 1]()).resolves.toBeUndefined();
  });

  it('the real ping is skipped outside production', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await pingIndexNow(['/faq']);
    expect(res).toMatchObject({ sent: 0 });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('the IndexNow key file', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is served at /<key>.txt through the proxy rewrite', async () => {
    expect(discoveryRoute(`/${KEY}.txt`, KEY)).toEqual({ kind: 'rewrite', to: '/indexnow-key' });
    expect(discoveryRoute('/other.txt', KEY)).toBeNull();
    expect(discoveryRoute(`/${KEY}.txt`, undefined)).toBeNull();
    vi.stubEnv('INDEXNOW_KEY', KEY);
    const res = keyRoute();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEY);
  });

  it('answers 404 when no key is set', () => {
    vi.stubEnv('INDEXNOW_KEY', '');
    expect(keyRoute().status).toBe(404);
  });
});

describe('proxy rewrites for discovery', () => {
  it('sends <page>.md to the markdown twin handler', () => {
    expect(discoveryRoute('/rentals/cameras-optics/sony-fx3.md', undefined)).toEqual({ kind: 'rewrite', to: '/md/rentals/cameras-optics/sony-fx3' });
    expect(discoveryRoute('/faq.md', undefined)).toEqual({ kind: 'rewrite', to: '/md/faq' });
    expect(discoveryRoute('/api/x.md', undefined)).toBeNull();
    expect(discoveryRoute('/md/faq.md', undefined)).toBeNull();
  });

  it('marks the machine endpoints so the proxy skips the session refresh', () => {
    for (const p of ['/v1/rentals', '/mcp', '/llms.txt', '/llms-full.txt', '/openapi.json', '/.well-known/mcp.json']) {
      expect(discoveryRoute(p, undefined)).toEqual({ kind: 'machine' });
    }
    expect(discoveryRoute('/rentals', undefined)).toBeNull();
  });
});
