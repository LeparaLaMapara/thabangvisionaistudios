import { describe, it, expect } from 'vitest';
import { interleaveShowcase } from '@/lib/home/showcase';
import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';

const item = (id: string, category: CarouselItem['category']): CarouselItem => ({
  id,
  slug: id,
  title: id,
  description: null,
  thumbnail_url: null,
  video_url: null,
  tags: [],
  category,
  meta: '',
  created_at: '2026-08-27T00:00:00.000Z',
});

const work = (n: number) => Array.from({ length: n }, (_, i) => item(`w${i}`, 'production'));
const gear = (n: number) => Array.from({ length: n }, (_, i) => item(`g${i}`, 'rental'));

describe('interleaveShowcase', () => {
  it('alternates work and gear, work first', () => {
    const out = interleaveShowcase(work(3), gear(3));
    expect(out.map(i => i.id)).toEqual(['w0', 'g0', 'w1', 'g1', 'w2', 'g2']);
  });

  it('keeps the tail when there is more gear than work', () => {
    // The real case: 25 listings against a handful of published productions.
    // Dropping the remainder would hide most of the catalogue.
    const out = interleaveShowcase(work(1), gear(4));
    expect(out.map(i => i.id)).toEqual(['w0', 'g0', 'g1', 'g2', 'g3']);
  });

  it('keeps the tail when there is more work than gear', () => {
    const out = interleaveShowcase(work(4), gear(1));
    expect(out.map(i => i.id)).toEqual(['w0', 'g0', 'w1', 'w2', 'w3']);
  });

  it('loses nothing', () => {
    expect(interleaveShowcase(work(5), gear(8))).toHaveLength(13);
  });

  it('returns gear alone when no productions are published', () => {
    // smart_productions is behind a feature flag, so this is a live scenario,
    // not a hypothetical. The rail must still carry the catalogue.
    const out = interleaveShowcase([], gear(3));
    expect(out.map(i => i.id)).toEqual(['g0', 'g1', 'g2']);
  });

  it('returns work alone when no gear is published', () => {
    const out = interleaveShowcase(work(2), []);
    expect(out.map(i => i.id)).toEqual(['w0', 'w1']);
  });

  it('is empty when both are empty, so the carousel falls back to placeholders', () => {
    expect(interleaveShowcase([], [])).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const w = work(2);
    const g = gear(2);
    interleaveShowcase(w, g);
    expect(w).toHaveLength(2);
    expect(g).toHaveLength(2);
  });
});
