import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => { throw new Error('not in this test'); }, createClient: async () => ({}) }));

const env = { ...process.env };
process.env.VAPID_PUBLIC_KEY = 'B'.repeat(87);
process.env.VAPID_PRIVATE_KEY = 'p'.repeat(43);

const { parseSubscription, parseEndpoint, isPushEndpoint, mayMoveSubscription } = await import('@/lib/push/subscriptions');
const { sendPush, safePushUrl, isPushConfigured } = await import('@/lib/push');
const { pushToUser, PUSH_MAX_FAILURES } = await import('@/lib/engagement/dispatch');

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
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [
                  { id: 'live', endpoint: 'https://fcm.googleapis.com/fcm/send/live', p256dh: 'k', auth: 'a' },
                  { id: 'dead', endpoint: 'https://fcm.googleapis.com/fcm/send/dead', p256dh: 'k', auth: 'a' },
                ],
              }),
            }),
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

describe('security fixes 2026-10-13 (088)', () => {
  it('only real push services are accepted (no SSRF to private or metadata addresses)', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://api.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) expect(isPushEndpoint(ok)).toBe(true);
    for (const bad of [
      'https://169.254.169.254/latest/meta-data/iam',
      'https://localhost:5432/x',
      'https://10.0.0.1/admin',
      'https://evil.example/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://notify.windows.com.evil.example/x',
      'https://evilnotify.windows.com/x',
      'https://fcm.googleapis.com:8443/x',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com/a\\b',
    ]) expect(isPushEndpoint(bad)).toBe(false);
    expect(parseSubscription({ ...good, endpoint: 'https://169.254.169.254/x' })).toBeNull();
  });

  it('a subscription moves to another account only with the same browser keys', () => {
    const stored = { user_id: 'a', p256dh: 'K1', auth: 'A1' };
    expect(mayMoveSubscription(stored, { userId: 'a', p256dh: 'X', auth: 'Y' })).toBe(true);
    expect(mayMoveSubscription(stored, { userId: 'b', p256dh: 'K1', auth: 'A1' })).toBe(true);
    expect(mayMoveSubscription(stored, { userId: 'b', p256dh: 'X', auth: 'A1' })).toBe(false);
  });

  it('notification links refuse tabs, newlines and other control characters', () => {
    expect(safePushUrl('/\t/evil.example')).toBe('/dashboard');
    expect(safePushUrl('/\n/evil.example')).toBe('/dashboard');
    expect(safePushUrl('/\r/evil.example')).toBe('/dashboard');
    expect(safePushUrl('/a b')).toBe('/dashboard');
    expect(safePushUrl('/dashboard?x=1#y')).toBe('/dashboard?x=1#y');
  });

  it('never sends to an endpoint that is not a push service', async () => {
    sendNotification.mockReset();
    const r = await sendPush({ endpoint: 'https://169.254.169.254/x', p256dh: 'k', auth: 'a' }, { title: 't', body: 'b', url: '/' });
    expect(r).toMatchObject({ ok: false, gone: true });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends to all browsers at once and drops one that keeps failing', async () => {
    const deleted: string[] = [];
    const counts: Record<string, number> = {};
    let inFlight = 0;
    let maxInFlight = 0;
    const rows = [
      { id: 's1', endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k', auth: 'a', failure_count: 0 },
      { id: 's2', endpoint: 'https://fcm.googleapis.com/fcm/send/2', p256dh: 'k', auth: 'a', failure_count: PUSH_MAX_FAILURES - 1 },
    ];
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }),
        delete: () => ({ eq: async (_c: string, id: string) => { deleted.push(id); return {}; } }),
        update: (v: { failure_count: number }) => ({ eq: async (_c: string, id: string) => { counts[id] = v.failure_count; return {}; } }),
      }),
    };
    sendNotification.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      throw Object.assign(new Error('busy'), { statusCode: 503 });
    });
    const r = await pushToUser(admin as never, 'u1', { title: 't', body: 'b', url: '/' });
    expect(maxInFlight).toBe(2);
    expect(r.sent).toBe(0);
    expect(deleted).toEqual(['s2']);
    expect(counts.s1).toBe(1);
  });
});
