// @vitest-environment node
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  ID_PHOTO_ACCEPT,
  isHeic,
  sniffPhotoType,
  submitErrorMessage,
  validateIdPhoto,
} from '@/lib/verification/photo-format';
import {
  maskIdNumber,
  parseIdReading,
  summariseIdReading,
  validSaIdNumber,
} from '@/lib/verification/id-reading';
import { makeReviewCopy, REVIEW_MAX_EDGE } from '@/lib/verification/review-copy';
import { isOwnStagingPath, stagingPath } from '@/lib/verification/submit-guards';
import {
  preferFileMetadata,
  sanitizeClientMetadata,
  type PhotoMetadata,
  type VerificationMetadata,
} from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';

const MB = 1024 * 1024;

/** A made-up SA ID number with a correct check digit (born 1980-01-01). */
function fakeSaId(): string {
  const first12 = '800101500908';
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(first12[i]);
    if (i % 2 !== 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return first12 + String((10 - (sum % 10)) % 10);
}

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const asciiBytes = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

describe('photo format: photos only, judged by the bytes', () => {
  it('recognises JPEG, PNG, WebP and HEIC, and refuses PDF', () => {
    expect(sniffPhotoType(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe('image/jpeg');
    expect(sniffPhotoType(bytes(0x89, ...asciiBytes('PNG')))).toBe('image/png');
    expect(sniffPhotoType(bytes(...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('WEBP')))).toBe('image/webp');
    expect(sniffPhotoType(bytes(0, 0, 0, 0x18, ...asciiBytes('ftypheic')))).toBe('image/heic');
    expect(sniffPhotoType(bytes(...asciiBytes('%PDF-1.7')))).toBeNull();
  });

  it('the picker offers no PDF, and the first check refuses one', () => {
    expect(ID_PHOTO_ACCEPT).not.toContain('pdf');
    expect(validateIdPhoto({ type: 'application/pdf', name: 'id.pdf', size: MB }).valid).toBe(false);
    expect(validateIdPhoto({ type: 'image/heic', name: 'IMG_1.HEIC', size: 3 * MB }).valid).toBe(true);
    // Some phones report no type for HEIC: the name decides.
    expect(isHeic({ type: '', name: 'IMG_1.heic' })).toBe(true);
    expect(validateIdPhoto({ type: 'image/jpeg', name: 'a.jpg', size: 12 * MB }).valid).toBe(true);
    expect(validateIdPhoto({ type: 'image/jpeg', name: 'a.jpg', size: 10 * 1024 }).valid).toBe(false);
    expect(validateIdPhoto({ type: 'image/jpeg', name: 'a.jpg', size: 40 * MB }).valid).toBe(false);
  });

  it('gives plain words for a refused request', () => {
    expect(submitErrorMessage(413, undefined)).toMatch(/too large/);
    expect(submitErrorMessage(400, 'Selfie: blurry')).toBe('Selfie: blurry');
  });
});

describe('review copy (made after the original was read)', () => {
  it('is a JPEG, long edge 2400, with no EXIF', async () => {
    const original = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#808080' } })
      .withExif({ IFD0: { Make: 'samsung', Model: 'SM-S918B' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const copy = await makeReviewCopy(original);
    const meta = await sharp(copy).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(REVIEW_MAX_EDGE);
    expect(meta.exif).toBeUndefined();
  });

  it('refuses bytes that are not an image', async () => {
    await expect(makeReviewCopy(Buffer.from('%PDF-1.7 not an image at all'))).rejects.toThrow();
  });
});

describe('ID reading: the model transcribes, the code checks', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const id = fakeSaId();

  it('cleans the model answer', () => {
    const r = parseIdReading({
      document_type: 'passport',
      readable: true,
      id_number: `${id.slice(0, 6)} ${id.slice(6)}`,
      surname: '  DOE ',
      names: 'JANE',
      date_of_birth: '1980-01-01',
      expiry_date: 'soon',
      confidence: 3,
    });
    expect(r).toMatchObject({ document_type: 'passport', id_number: id, surname: 'DOE', expiry_date: null, confidence: 1 });
    expect(parseIdReading('garbage')).toMatchObject({ document_type: 'other_id', readable: false, id_number: null });
    expect(parseIdReading({ document_type: 'banana' }).document_type).toBe('other_id');
  });

  it('checks the number, the birth date inside it and the expiry; stores no full number', () => {
    const good = parseIdReading({
      document_type: 'smart_id_card', readable: true, id_number: id,
      date_of_birth: '1980-01-01', expiry_date: '2030-01-01', confidence: 0.9,
    });
    const s = summariseIdReading(good, now);
    expect(s).toMatchObject({ id_number_valid: true, dob_matches_id_number: true, expired: false });
    expect(s.id_number_masked).toBe(maskIdNumber(id));
    expect(JSON.stringify(s)).not.toContain(id);
    expect(validSaIdNumber(good)).toBe(id);

    const bad = parseIdReading({
      document_type: 'smart_id_card', readable: true, id_number: id.slice(0, 12) + ((Number(id[12]) + 1) % 10),
      date_of_birth: '1981-05-05', expiry_date: '2020-01-01',
    });
    const b = summariseIdReading(bad, now);
    expect(b).toMatchObject({ id_number_valid: false, expired: true });
    expect(validSaIdNumber(bad)).toBeNull();
  });

  it('masks all but the birth date and the last three digits', () => {
    expect(maskIdNumber('8001015009087')).toBe('800101****087');
  });
});

describe('fraud flags from the ID reading', () => {
  const empty: PhotoMetadata = { dateTaken: null, gps: null, device: 'x', software: null, imageWidth: null, imageHeight: null };
  const base = (doc: VerificationMetadata['id_document']): VerificationMetadata => ({
    id_front: empty, id_back: empty, selfie: { ...empty, dateTaken: new Date().toISOString() }, face_match: null, id_document: doc,
  });
  const summary = (over: object) => ({
    document_type: 'smart_id_card' as const, readable: true, confidence: 0.9, surname: null, names: null,
    date_of_birth: '1980-01-01', expiry_date: null, id_number_masked: '800101****087',
    id_number_valid: true, dob_matches_id_number: true, expired: false, checked_at: '', ...over,
  });
  const codes = (doc: VerificationMetadata['id_document']) => detectFraudFlags(base(doc), null).map((f) => f.code);

  it('flags a non-ID, an unreadable photo, a bad number, a birth-date mismatch, an expired document', () => {
    expect(codes(summary({ document_type: 'not_an_id' }))).toContain('NOT_AN_ID');
    expect(codes(summary({ readable: false }))).toContain('ID_UNREADABLE');
    expect(codes(summary({ id_number_valid: false }))).toContain('ID_NUMBER_INVALID');
    expect(codes(summary({ dob_matches_id_number: false }))).toContain('ID_DOB_MISMATCH');
    expect(codes(summary({ expired: true }))).toContain('ID_EXPIRED');
    expect(codes(summary({}))).toEqual([]);
    expect(codes(null)).toEqual([]);
  });
});

describe('staging paths', () => {
  const user = '11111111-2222-3333-4444-555555555555';
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('accepts only a path this server issues, for this user and this photo', () => {
    const p = stagingPath(user, 'id_copy', uuid);
    expect(isOwnStagingPath(p, user, 'id_copy')).toBe(true);
    expect(isOwnStagingPath(p, user, 'selfie_with_id')).toBe(false);
    expect(isOwnStagingPath(p, '99999999-2222-3333-4444-555555555555', 'id_copy')).toBe(false);
    expect(isOwnStagingPath(`${user}/${uuid}-id-copy`, user, 'id_copy')).toBe(false);
    expect(isOwnStagingPath(`${p}/../../other`, user, 'id_copy')).toBe(false);
    expect(isOwnStagingPath(42, user, 'id_copy')).toBe(false);
  });
});

describe('EXIF read in the browser (for HEIC photos converted there)', () => {
  const empty: PhotoMetadata = { dateTaken: null, gps: null, device: null, software: null, imageWidth: null, imageHeight: null };

  it('keeps well-formed values and drops malformed ones', () => {
    expect(sanitizeClientMetadata({ dateTaken: '2026-10-14T00:30:00.000Z', device: 'Apple iPhone 13', gps: { latitude: -26.2, longitude: 28 } }))
      .toMatchObject({ dateTaken: '2026-10-14T00:30:00.000Z', device: 'Apple iPhone 13', gps: { latitude: -26.2, longitude: 28 } });
    expect(sanitizeClientMetadata({ dateTaken: 'yesterday', gps: { latitude: 500, longitude: 1 } })).toMatchObject({ dateTaken: null, gps: null });
    expect(sanitizeClientMetadata('nope')).toBeNull();
  });

  it("prefers the file's own EXIF", () => {
    const fromFile = { ...empty, device: 'samsung SM-S918B' };
    const fromBrowser = { ...empty, device: 'Apple iPhone 13' };
    expect(preferFileMetadata(fromFile, fromBrowser)).toBe(fromFile);
    expect(preferFileMetadata(empty, fromBrowser)).toBe(fromBrowser);
  });
});
