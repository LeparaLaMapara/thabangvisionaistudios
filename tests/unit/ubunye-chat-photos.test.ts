import { describe, expect, it } from 'vitest';
import { UBUNYE_PHOTO_POLICY } from '@/lib/constants';
import { composePhotoMessage, fitWithin, photoFileProblem, photosLeft, visibleUserText } from '@/lib/ubunye/chat-photos';

describe('fitWithin (the in-browser resize size)', () => {
  it('scales a phone photo so the long side is 1600', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('never makes a small photo bigger', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('keeps the shape and rounds to whole pixels', () => {
    const { width, height } = fitWithin(5000, 3333);
    expect(width).toBe(1600);
    expect(height).toBe(Math.round(3333 * (1600 / 5000)));
  });

  it('keeps at least one pixel on a very thin image', () => {
    expect(fitWithin(20000, 2)).toEqual({ width: 1600, height: 1 });
  });

  it('gives zero for an empty or broken size', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
  });

  it('uses the policy long side by default', () => {
    expect(UBUNYE_PHOTO_POLICY.maxSide).toBe(1600);
    expect(fitWithin(3200, 100, 800)).toEqual({ width: 800, height: 25 });
  });
});

describe('photoFileProblem', () => {
  it('refuses a file over 10 MB before resizing, in plain words', () => {
    expect(photoFileProblem({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe('That photo is over 10 MB. Choose a smaller one.');
  });

  it('accepts a photo up to 10 MB', () => {
    expect(photoFileProblem({ type: 'image/heic', size: 10 * 1024 * 1024 })).toBeNull();
  });

  it('refuses a file that is not a photo', () => {
    expect(photoFileProblem({ type: 'application/pdf', size: 1000 })).toBe('That file is not a photo. Choose a photo.');
  });
});

describe('photosLeft', () => {
  it('allows three photos per message', () => {
    expect(photosLeft(0)).toBe(3);
    expect(photosLeft(2)).toBe(1);
    expect(photosLeft(3)).toBe(0);
    expect(photosLeft(5)).toBe(0);
  });
});

describe('composePhotoMessage (one text part)', () => {
  it('puts the words, a blank line, then one line per photo', () => {
    expect(composePhotoMessage('This look for my wedding', ['Photo the client sent: a gold dress.', 'Photo the client sent: a garden.'])).toBe(
      'This look for my wedding\n\nPhoto the client sent: a gold dress.\nPhoto the client sent: a garden.',
    );
  });

  it('uses "Here is a photo." when there are no words', () => {
    expect(composePhotoMessage('   ', ['Photo the client sent: a red car.'])).toBe('Here is a photo.\n\nPhoto the client sent: a red car.');
  });

  it('is just the words when no photo was read', () => {
    expect(composePhotoMessage(' hello ', [])).toBe('hello');
  });
});

describe('visibleUserText (the client never sees our description)', () => {
  it('hides every description line', () => {
    const sent = composePhotoMessage('Like this please', ['Photo the client sent: a gold dress.', 'Photo the client sent: a garden.']);
    expect(visibleUserText(sent)).toBe('Like this please');
  });

  it('keeps a photo-only message readable', () => {
    expect(visibleUserText(composePhotoMessage('', ['Photo the client sent: a red car.']))).toBe('Here is a photo.');
  });

  it('leaves ordinary text alone', () => {
    expect(visibleUserText('A wedding on Saturday\nin Soweto')).toBe('A wedding on Saturday\nin Soweto');
  });
});
