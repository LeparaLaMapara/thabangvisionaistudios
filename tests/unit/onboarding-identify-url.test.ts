import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// identify-gear makes the server fetch the image, so only our own uploads
// are accepted (no server-side fetch of arbitrary addresses).
const identifyGear = vi.fn(async () => ({ name: 'Camera' }));
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ error: null, user: { id: 'u1' } }),
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/agents/tools', () => ({ identifyGear }));
vi.mock('@/app/api/listings/_lib/images', () => ({
  isOwnImageUrl: (url: string) => url.startsWith('https://res.cloudinary.com/our-cloud/image/upload/'),
}));

const { POST } = await import('@/app/api/agents/onboarding/route');
const call = (imageUrl: string) =>
  POST(new NextRequest('http://localhost/api/agents/onboarding', { method: 'POST', body: JSON.stringify({ action: 'identify-gear', imageUrl }) }));

describe('identify-gear only fetches our own uploads', () => {
  beforeEach(() => identifyGear.mockClear());

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/api/admin',
    'https://evil.example/cam.jpg',
    'https://res.cloudinary.com/other-cloud/image/upload/x.jpg',
  ])('refuses %s without fetching it', async (url) => {
    const res = await call(url);
    expect(res.status).toBe(400);
    expect(identifyGear).not.toHaveBeenCalled();
  });

  it('accepts a photo uploaded to our account', async () => {
    const res = await call('https://res.cloudinary.com/our-cloud/image/upload/v1/gear/cam.jpg');
    expect(res.status).toBe(200);
    expect(identifyGear).toHaveBeenCalledTimes(1);
  });
});
