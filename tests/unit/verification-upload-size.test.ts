import { describe, it, expect } from 'vitest';
import {
  SHRINK_ABOVE_BYTES,
  UPLOAD_BUDGET_BYTES,
  canShrink,
  fitWithin,
  fitsUploadBudget,
  needsShrink,
  submitErrorMessage,
} from '@/lib/verification/upload-size';
import {
  preferFileMetadata,
  sanitizeClientMetadata,
  type PhotoMetadata,
} from '@/lib/metadata/verification';

const MB = 1024 * 1024;

describe('upload size (Vercel refuses request bodies over 4.5 MB)', () => {
  it('keeps the whole submission under the host limit', () => {
    expect(UPLOAD_BUDGET_BYTES).toBeLessThan(4.5 * MB);
    expect(fitsUploadBudget([1.5 * MB, 1.5 * MB])).toBe(true);
    // Two ordinary phone photos: the case that failed on 2026-10-14.
    expect(fitsUploadBudget([2.6 * MB, 2.4 * MB])).toBe(false);
  });

  it('shrinks large JPG/PNG/WebP photos only', () => {
    expect(needsShrink({ type: 'image/jpeg', size: 3 * MB })).toBe(true);
    expect(needsShrink({ type: 'image/jpeg', size: SHRINK_ABOVE_BYTES })).toBe(false);
    expect(needsShrink({ type: 'application/pdf', size: 3 * MB })).toBe(false);
    expect(needsShrink({ type: 'image/heic', size: 3 * MB })).toBe(false);
    expect(canShrink('image/webp')).toBe(true);
  });

  it('keeps the aspect ratio when fitting the long edge', () => {
    expect(fitWithin(4000, 3000, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(3000, 4000, 2400)).toEqual({ width: 1800, height: 2400 });
    expect(fitWithin(1200, 900, 2400)).toEqual({ width: 1200, height: 900 });
  });

  it('turns the host 413 into plain words and keeps server messages', () => {
    expect(submitErrorMessage(413, undefined)).toMatch(/too large/);
    expect(submitErrorMessage(400, 'Selfie: File is too small')).toBe('Selfie: File is too small');
    expect(submitErrorMessage(500, undefined)).toMatch(/try again/);
  });
});

describe('metadata read in the browser before shrinking', () => {
  const empty: PhotoMetadata = {
    dateTaken: null, gps: null, device: null, software: null, imageWidth: null, imageHeight: null,
  };

  it('accepts well-formed EXIF and drops anything malformed', () => {
    const m = sanitizeClientMetadata({
      dateTaken: '2026-10-14T00:30:00.000Z',
      gps: { latitude: -26.19, longitude: 28.03 },
      device: 'samsung SM-S918B',
      software: 42,
      imageWidth: 4000,
      imageHeight: 'tall',
    });
    expect(m).toEqual({
      dateTaken: '2026-10-14T00:30:00.000Z',
      gps: { latitude: -26.19, longitude: 28.03 },
      device: 'samsung SM-S918B',
      software: null,
      imageWidth: 4000,
      imageHeight: null,
    });
    expect(sanitizeClientMetadata('nope')).toBeNull();
    expect(sanitizeClientMetadata({ dateTaken: 'yesterday', gps: { latitude: 500, longitude: 1 } })?.dateTaken).toBeNull();
    expect(sanitizeClientMetadata({ gps: { latitude: 500, longitude: 1 } })?.gps).toBeNull();
    expect(sanitizeClientMetadata({ device: 'x'.repeat(500) })?.device).toHaveLength(120);
  });

  it("prefers the file's own EXIF, and uses the browser's only when the file has none", () => {
    const fromFile = { ...empty, device: 'Apple iPhone 13' };
    const fromBrowser = { ...empty, device: 'samsung SM-S918B' };
    expect(preferFileMetadata(fromFile, fromBrowser)).toBe(fromFile);
    expect(preferFileMetadata(empty, fromBrowser)).toBe(fromBrowser);
    expect(preferFileMetadata(empty, null)).toBe(empty);
  });
});
