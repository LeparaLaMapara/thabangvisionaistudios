import { describe, it, expect } from 'vitest';
import { sanitizeDeviceLocation, distanceKm, inSouthAfrica } from '@/lib/verification/device-location';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import { submissionAlert } from '@/lib/verification/owner-alert';
import type { VerificationMetadata } from '@/lib/metadata/verification';

const now = new Date('2026-10-14T09:00:00Z');
const blank = { dateTaken: '2026-10-14T08:59:00Z', gps: null, device: 'Google Pixel 9', software: null, imageWidth: 4080, imageHeight: 3072 };
const meta = (device_location: VerificationMetadata['device_location'], gps: { latitude: number; longitude: number } | null = null): VerificationMetadata => ({
  id_front: { ...blank, gps }, id_back: { ...blank, gps }, selfie: { ...blank, gps }, face_match: null, id_document: null, device_location,
});
const codes = (m: VerificationMetadata) => detectFraudFlags(m, null).map((f) => f.code);

describe('location from the browser at submit', () => {
  it('keeps a real fix, rounded accuracy', () => {
    const l = sanitizeDeviceLocation({ status: 'shared', latitude: -25.7461, longitude: 28.1881, accuracy_m: 12.7, captured_at: '2026-10-14T08:59:30Z' }, now);
    expect(l).toEqual({ status: 'shared', latitude: -25.7461, longitude: 28.1881, accuracy_m: 13, captured_at: '2026-10-14T08:59:30.000Z' });
  });
  it('records a refusal, and turns junk into "unavailable"', () => {
    expect(sanitizeDeviceLocation({ status: 'denied', latitude: 1 }, now)).toMatchObject({ status: 'denied', latitude: null });
    expect(sanitizeDeviceLocation({ status: 'shared', latitude: 'x', longitude: 2 }, now).status).toBe('unavailable');
    expect(sanitizeDeviceLocation({ status: 'shared', latitude: 95, longitude: 2 }, now).status).toBe('unavailable');
    expect(sanitizeDeviceLocation(null, now).status).toBe('unavailable');
    expect(sanitizeDeviceLocation({ status: 'hacked' }, now).status).toBe('unavailable');
  });
  it('drops a fix time from the future', () => {
    expect(sanitizeDeviceLocation({ status: 'shared', latitude: -26, longitude: 28, captured_at: '2027-01-01T00:00:00Z' }, now).captured_at).toBeNull();
  });
  it('measures distance and the South Africa box', () => {
    expect(distanceKm({ latitude: -25.7461, longitude: 28.1881 }, { latitude: -26.2041, longitude: 28.0473 })).toBeGreaterThan(50);
    expect(distanceKm({ latitude: -25.7461, longitude: 28.1881 }, { latitude: -26.2041, longitude: 28.0473 })).toBeLessThan(60);
    expect(inSouthAfrica(-33.92, 18.42)).toBe(true);
    expect(inSouthAfrica(51.5, -0.12)).toBe(false);
  });
});

describe('location checks for the reviewer', () => {
  const pretoria = { status: 'shared' as const, latitude: -25.7461, longitude: 28.1881, accuracy_m: 15, captured_at: null };
  it('no warning when shared in South Africa and near the photo', () => {
    const c = codes(meta(pretoria, { latitude: -25.75, longitude: 28.19 }));
    expect(c.filter((x) => x.startsWith('LOCATION'))).toEqual([]);
  });
  it('flags a refusal, outside South Africa, and far from the photo', () => {
    expect(codes(meta({ status: 'denied', latitude: null, longitude: null, accuracy_m: null, captured_at: null }))).toContain('LOCATION_NOT_SHARED');
    expect(codes(meta({ ...pretoria, latitude: 51.5, longitude: -0.12 }))).toContain('LOCATION_OUTSIDE_SA');
    expect(codes(meta(pretoria, { latitude: -33.92, longitude: 18.42 }))).toContain('LOCATION_FAR_FROM_PHOTO');
  });
  it('older submissions without it get no location warning', () => {
    expect(codes(meta(undefined)).filter((x) => x.startsWith('LOCATION'))).toEqual([]);
  });
  it('the owner email says shared or refused, never the coordinates', () => {
    const a = submissionAlert({ name: 'Jane', email: null, attempt: 1, flags: [], metadata: meta(pretoria) });
    expect(a.text).toContain('Location: shared (within 15 m)');
    expect(a.text).not.toContain('25.74');
    const b = submissionAlert({ name: 'Jane', email: null, attempt: 1, flags: [], metadata: meta({ status: 'denied', latitude: null, longitude: null, accuracy_m: null, captured_at: null }) });
    expect(b.text).toContain('Location: REFUSED');
  });
});
