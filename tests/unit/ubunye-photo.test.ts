import { describe, it, expect } from 'vitest';
import { parsePhotoDataUrl, photoNote, PHOTO_PREFIX, PHOTO_INSTRUCTIONS } from '@/lib/ubunye/photo';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]).toString('base64');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(60, 3)]).toString('base64');

describe('parsePhotoDataUrl', () => {
  it('accepts real JPEG, PNG and WebP bytes', () => {
    expect(parsePhotoDataUrl(`data:image/jpeg;base64,${jpeg}`, 1e6)).toMatchObject({ ok: true, mime: 'image/jpeg' });
    expect(parsePhotoDataUrl(`data:image/png;base64,${png}`, 1e6)).toMatchObject({ ok: true, mime: 'image/png' });
    expect(parsePhotoDataUrl(`data:image/webp;base64,${webp}`, 1e6)).toMatchObject({ ok: true, mime: 'image/webp' });
  });
  it('refuses a file that only claims to be a photo', () => {
    expect(parsePhotoDataUrl(`data:image/jpeg;base64,${png}`, 1e6)).toMatchObject({ ok: false, code: 'bad_image' });
    expect(parsePhotoDataUrl(`data:image/jpeg;base64,${Buffer.from('<svg onload=x>').toString('base64')}`, 1e6)).toMatchObject({ ok: false });
  });
  it('refuses other types, non-strings and links', () => {
    expect(parsePhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 1e6)).toMatchObject({ ok: false });
    expect(parsePhotoDataUrl('https://example.com/a.jpg', 1e6)).toMatchObject({ ok: false });
    expect(parsePhotoDataUrl(42, 1e6)).toMatchObject({ ok: false });
  });
  it('refuses a photo over the size limit', () => {
    expect(parsePhotoDataUrl(`data:image/jpeg;base64,${jpeg}`, 10)).toMatchObject({ ok: false, code: 'too_big' });
  });
});

describe('photoNote', () => {
  it('makes one plain marked line without long dashes', () => {
    const note = photoNote('A bride in a red and gold dress — warm evening light.\n\nIt suits a traditional wedding shoot.');
    expect(note?.startsWith(PHOTO_PREFIX)).toBe(true);
    expect(note).not.toMatch(/[—–\n]/);
  });
  it('gives nothing for an empty answer', () => {
    expect(photoNote('  ')).toBeNull();
  });
  it('is bounded', () => {
    expect((photoNote('word '.repeat(1000)) ?? '').length).toBeLessThan(700);
  });
});

describe('PHOTO_INSTRUCTIONS', () => {
  it('never asks the model to identify people', () => {
    expect(PHOTO_INSTRUCTIONS).toMatch(/never say who a person is/);
    expect(PHOTO_INSTRUCTIONS).toMatch(/race, ethnicity, age/);
  });
});
