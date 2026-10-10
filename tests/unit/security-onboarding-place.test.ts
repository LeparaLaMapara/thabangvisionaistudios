/**
 * Phase 6 security, INJ-1 (write path): POST /api/onboarding concatenated
 * city/province into profiles.location with only a .trim() check, and that
 * value is rendered on public creator pages. City and province are now held to
 * a place-name charset; street address / postal code / country refuse markup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { validatePlaceName, validatePlainText } from '@/lib/security/text';

const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      update,
    }),
  }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));

const { POST } = await import('@/app/api/onboarding/route');

const base = {
  firstName: 'Thandi',
  lastName: 'Nkosi',
  phone: '0821234567',
  streetAddress: '1 Main Road',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2196',
  avatarUrl: 'https://res.cloudinary.com/our/image/upload/a.jpg',
};
const call = (over: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/onboarding', { method: 'POST', body: JSON.stringify({ ...base, ...over }) }));

describe('onboarding refuses markup in public profile fields (INJ-1)', () => {
  beforeEach(() => update.mockClear());

  it.each([
    { city: 'Jozi</script><script>window.__XSS__=1</script>' },
    { province: 'Gauteng<img src=x onerror=alert(1)>' },
    { city: ['Johannesburg'] },
    { streetAddress: '1 Main <script>' },
    { postalCode: '2196"><svg onload=1>' },
  ])('refuses %j without writing the profile', async (over) => {
    const res = await call(over);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts real South African place names', async () => {
    for (const [city, province] of [
      ['Johannesburg', 'Gauteng'],
      ["KwaDukuza (Stanger)", 'KwaZulu-Natal'],
      ['Mbombela', 'Mpumalanga'],
      ['Hout Bay & Llandudno', 'Western Cape'],
    ]) {
      update.mockClear();
      const res = await call({ city, province });
      expect(res.status).toBe(200);
      expect(update).toHaveBeenCalledTimes(1);
    }
  });
});

describe('text validators', () => {
  it('validatePlaceName', () => {
    expect(validatePlaceName('Sandton', 'City').valid).toBe(true);
    expect(validatePlaceName('Sandton<', 'City').valid).toBe(false);
    expect(validatePlaceName('x'.repeat(81), 'City').valid).toBe(false);
    expect(validatePlaceName(42, 'City').valid).toBe(false);
  });
  it('validatePlainText', () => {
    expect(validatePlainText('12 Long St, Apt 4', 'Street', 200).valid).toBe(true);
    expect(validatePlainText('a>b', 'Street', 200).valid).toBe(false);
  });
});
