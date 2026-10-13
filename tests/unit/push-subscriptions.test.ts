import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => { throw new Error('not in this test'); }, createClient: async () => ({}) }));

const env = { ...process.env };
process.env.VAPID_PUBLIC_KEY = 'B'.repeat(87);
process.env.VAPID_PRIVATE_KEY = 'p'.repeat(43);

const { parseSubscription, parseEndpoint } = await import('@/lib/push/subscriptions');
const { sendPush, safePushUrl, isPushConfigured } = await import('@/lib/push');
const { pushToUser } = await import('@/lib/engagement/dispatch');

afterAll(() => {
  process.env = env;
});

const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };

describe('saving a browser subscription', () => {
  it('accepts a real-looking subscription', () => {
    expect(parseSubscription(good)).toEqual({ endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth });
  });
  it('refuses http, credentials in the URL, junk keys and missing parts', () => {
    expect(parseSubscription({ ...good, endpoint: 'http://push.example/x' })).toBeNull();
    expect(parseSubscription({ ...good, endpoint: 'https://u:p@push.example/x' })).toBeNull();
    expect(parseSubscription({ ...good, endpoint: 'not a url' })).toBeNull();
    expect(parseSubscription({ ...good, keys: { p256dh: 'short', auth: good.keys.auth } })).toBeNull();
    expect(parseSubscription({ ...good, keys: { p256dh: good.keys.p256dh, auth: 'has spaces in it' } })).toBeNull();
    expect(parseSubscription({ endpoint: good.endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription({ ...good, endpoint: `https://x.example/${'a'.repeat(1000)}` })).toBeNull();
  });
  it('removing needs an https endpoint', () => {
    expect(parseEndpoint({ endpoint: good.endpoint })).toBe(good.endpoint);
    expect(parseEndpoint({ endpoint: 'javascript:alert(1)' })).toBeNull();
    expect(parseEndpoint({})).toBeNull();
  });
});

describe('sending a push', () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it('is configured from env', () => {
    expect(isPushConfigured()).toBe(true);
  });

  it('opens only paths on this site', () => {
    expect(safePushUrl('/dashboard/bookings/1')).toBe('/dashboard/bookings/1');
    expect(safePushUrl('https://evil.example')).toBe('/dashboard');
    expect(safePushUrl('//evil.example')).toBe('/dashboard');
    expect(safePushUrl(null)).toBe('/dashboard');
  });

  it('sends a small JSON payload with VAPID details', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const r = await sendPush({ endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth }, { title: 'Booked', body: 'Your gear is confirmed', url: '/dashboard' });
    expect(r).toEqual({ ok: true });
    const [sub, payload, opts] = sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh, auth: good.keys.auth } });
    expect(JSON.parse(payload)).toEqual({ title: 'Booked', body: 'Your gear is confirmed', url: '/dashboard' });
    expect(opts.vapidDetails.subject).toMatch(/^mailto:/);
  });

  it('404 and 410 mean the browser dropped it', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));
    expect(await sendPush({ endpoint: good.endpoint, p256dh: 'x', auth: 'y' }, { title: 't', body: 'b', url: '/' })).toMatchObject({ ok: false, gone: true });
    sendNotification.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }));
    expect(await sendPush({ endpoint: good.endpoint, p256dh: 'x', auth: 'y' }, { title: 't', body: 'b', url: '/' })).toMatchObject({ ok: false, gone: true });
    sendNotification.mockRejectedValue(Object.assign(new Error('busy'), { statusCode: 503 }));
    expect(await sendPush({ endpoint: good.endpoint, p256dh: 'x', auth: 'y' }, { title: 't', body: 'b', url: '/' })).toMatchObject({ ok: false, gone: false, retryable: true });
  });

  it('pushToUser deletes expired subscriptions and keeps working ones', async () => {
    const deleted: string[] = [];
    const updated: string[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: [
              { id: 'live', endpoint: 'https://push.example/live', p256dh: 'k', auth: 'a' },
              { id: 'dead', endpoint: 'https://push.example/dead', p256dh: 'k', auth: 'a' },
            ],
          }),
        }),
        delete: () => ({ eq: async (_c: string, id: string) => { deleted.push(id); return {}; } }),
        update: () => ({ eq: async (_c: string, id: string) => { updated.push(id); return {}; } }),
      }),
    };
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/dead')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const r = await pushToUser(admin as never, 'u1', { title: 't', body: 'b', url: '/' });
    expect(r).toEqual({ sent: 1, gone: 1, error: undefined });
    expect(deleted).toEqual(['dead']);
    expect(updated).toEqual(['live']);
  });
});
