// @vitest-environment node
// The two failures seen on production on 2026-10-14 (POST /api/verifications 500).
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { firstJsonObject } from '@/lib/ai/json-answer';
import { extractPhotoMetadata } from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';

async function phonePhotoWithGps(ref: 'S' | 'N') {
  const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'samsung', Model: 'SM-A546E' },
      IFD3: { GPSLatitudeRef: ref, GPSLatitude: '25/1 44/1 3000/100', GPSLongitudeRef: 'E', GPSLongitude: '28/1 11/1 2000/100' },
    })
    .toBuffer();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer;
}

describe('phone GPS (crashed with "toFixed is not a function")', () => {
  it('reads signed decimal degrees, not [deg, min, sec]', async () => {
    const meta = await extractPhotoMetadata(await phonePhotoWithGps('S'));
    expect(meta.gps?.latitude).toBeCloseTo(-25.7417, 3);
    expect(meta.gps?.longitude).toBeCloseTo(28.1889, 3);
    expect(meta.device).toBe('samsung SM-A546E');
  });

  it('a Pretoria selfie is not flagged outside South Africa; a northern one is, without crashing', async () => {
    const sa = await extractPhotoMetadata(await phonePhotoWithGps('S'));
    const north = await extractPhotoMetadata(await phonePhotoWithGps('N'));
    const codes = (selfie: typeof sa) =>
      detectFraudFlags({ id_front: sa, id_back: sa, selfie, face_match: null, id_document: null }, null).map((f) => f.code);
    expect(codes(sa)).not.toContain('GPS_OUTSIDE_SA');
    expect(codes(north)).toContain('GPS_OUTSIDE_SA');
  });

  it('a malformed GPS value cannot crash the checks', () => {
    const bad = { dateTaken: null, gps: { latitude: [25, 44, 30], longitude: [28, 11, 20] }, device: null, software: null, imageWidth: null, imageHeight: null } as never;
    expect(() => detectFraudFlags({ id_front: bad, id_back: bad, selfie: bad, face_match: null, id_document: null }, null)).not.toThrow();
  });
});

describe('model answers (crashed with "Unexpected non-whitespace character after JSON")', () => {
  it('takes the first object when a second one follows', () => {
    const text = '{"document_type": "passport", "readable": true}\n{"note": "second"}';
    expect(firstJsonObject(text)).toEqual({ document_type: 'passport', readable: true });
  });
  it('handles code fences, prose and braces inside strings', () => {
    const text = 'Here you go:\n```json\n{"reasoning": "a } inside", "match": true}\n```\nDone {not json}';
    expect(firstJsonObject(text)).toEqual({ reasoning: 'a } inside', match: true });
  });
  it('skips a broken object and finds a good one after it', () => {
    expect(firstJsonObject('{oops} {"a": 1}')).toEqual({ a: 1 });
  });
  it('returns null when there is no object', () => {
    expect(firstJsonObject('no answer')).toBeNull();
    expect(firstJsonObject('[1,2]')).toBeNull();
  });
});

describe('webcam photos (a small file can still be a readable photo)', () => {
  it('a 640 x 480 webcam frame passes the size rules; a thumbnail does not', async () => {
    const { photoSize } = await import('@/lib/verification/review-copy');
    const { MIN_ID_PHOTO_EDGE, MIN_ID_PHOTO_BYTES } = await import('@/lib/verification/photo-format');
    const webcam = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3a6' } }).jpeg({ quality: 92 }).toBuffer();
    const thumb = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    expect(Math.min(...Object.values((await photoSize(webcam))!))).toBeGreaterThanOrEqual(MIN_ID_PHOTO_EDGE);
    expect(Math.min(...Object.values((await photoSize(thumb))!))).toBeLessThan(MIN_ID_PHOTO_EDGE);
    expect(MIN_ID_PHOTO_BYTES).toBeLessThanOrEqual(10 * 1024);
    expect(await photoSize(Buffer.from('not a photo'))).toBeNull();
  });
});

describe('when the photo was taken (a Pixel 9 photo came through with no time)', () => {
  const shot = async (exif: Record<string, Record<string, string>>) => {
    const b = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } }).jpeg().withExif(exif).toBuffer();
    return extractPhotoMetadata(b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer);
  };
  it('uses the shutter time when there is one', async () => {
    const m = await shot({ IFD0: { Make: 'Google', Model: 'Pixel 9' }, IFD2: { DateTimeOriginal: '2026:10:14 08:49:00' } });
    expect(m.dateTaken).not.toBeNull();
  });
  it('falls back to the GPS clock (UTC)', async () => {
    const m = await shot({ IFD0: { Make: 'Google', Model: 'Pixel 9' }, IFD3: { GPSDateStamp: '2026:10:14', GPSTimeStamp: '6/1 49/1 30/1' } });
    expect(m.dateTaken).toBe('2026-10-14T06:49:30.000Z');
  });
  it('falls back to the saved time last', async () => {
    const m = await shot({ IFD0: { Make: 'Google', Model: 'Pixel 9', DateTime: '2026:10:14 08:49:00' } });
    expect(m.dateTaken).not.toBeNull();
  });
});
