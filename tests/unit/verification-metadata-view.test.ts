import { describe, expect, it } from 'vitest';
import { EMPTY_PHOTO_METADATA, photoMetadataOrEmpty, verificationPhotos } from '@/lib/metadata/photo-metadata-view';

// The admin verification review crashed ("This page couldn't load") when a
// submission's verification_metadata was `{}` (the submit RPCs' default):
// MetadataCard read `.dateTaken` of undefined. Every stored shape must give
// three readable photo records.
describe('verificationPhotos', () => {
  it('gives three empty records for {} (the database default)', () => {
    const photos = verificationPhotos({});
    expect(photos.selfie).toEqual(EMPTY_PHOTO_METADATA);
    expect(photos.id_front).toEqual(EMPTY_PHOTO_METADATA);
    expect(photos.id_back).toEqual(EMPTY_PHOTO_METADATA);
  });

  it('tolerates null, arrays and partial objects', () => {
    expect(verificationPhotos(null).selfie.dateTaken).toBeNull();
    expect(verificationPhotos([]).id_back.device).toBeNull();
    const partial = verificationPhotos({ selfie: { device: 'Pixel 8' } });
    expect(partial.selfie.device).toBe('Pixel 8');
    expect(partial.id_front).toEqual(EMPTY_PHOTO_METADATA);
  });

  it('keeps well-formed metadata as it is', () => {
    const selfie = { dateTaken: '2026-10-01T10:00:00Z', gps: { latitude: -26.1, longitude: 28.05 }, device: 'iPhone', software: null, imageWidth: 100, imageHeight: 200 };
    expect(verificationPhotos({ selfie, id_front: selfie, id_back: selfie }).selfie).toEqual(selfie);
  });

  it('drops a malformed gps block instead of throwing later on .toFixed', () => {
    expect(photoMetadataOrEmpty({ gps: { latitude: 'x', longitude: 1 } }).gps).toBeNull();
    expect(photoMetadataOrEmpty({ gps: null }).gps).toBeNull();
  });
});
