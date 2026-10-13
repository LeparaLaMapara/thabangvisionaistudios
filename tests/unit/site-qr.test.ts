import { describe, expect, it } from 'vitest';
import { SITE_QR_URL, siteQrPng, siteQrSvg } from '@/lib/qr';

describe('site QR code', () => {
  it('points at the public site, tagged as a QR visit', () => {
    const url = new URL(SITE_QR_URL);
    expect(url.origin).toBe('https://www.thabangvision.com');
    expect(url.searchParams.get('utm_source')).toBe('qr');
  });

  it('renders an SVG and a large PNG', async () => {
    expect(await siteQrSvg()).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    const png = await siteQrPng();
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(2048);
  });
});
