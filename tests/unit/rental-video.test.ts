import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkYouTubeVideo, decodeEntities, isYouTubeId, youtubeEmbedUrl, youtubePosterUrl } from '@/lib/video/youtube';
import { looksOfficial, parseChoice, videoQuery } from '@/lib/video/find-product-video';
import { buildCsp } from '@/lib/security/csp';

const cands = [
  { id: 'aaaaaaaaaaa', title: 'Review', channel: 'Someone', description: '' },
  { id: 'bbbbbbbbbbb', title: 'Introducing DJI RS 5', channel: 'DJI', description: '' },
];

afterEach(() => vi.unstubAllGlobals());

describe('YouTube addresses', () => {
  it('embeds from youtube-nocookie.com, which the page may frame', () => {
    expect(youtubeEmbedUrl('nCFe2RoQxv0')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/nCFe2RoQxv0\?/);
    expect(youtubeEmbedUrl('nCFe2RoQxv0', true)).toContain('autoplay=1');
    expect(youtubePosterUrl('nCFe2RoQxv0')).toBe('https://i.ytimg.com/vi/nCFe2RoQxv0/hqdefault.jpg');
    expect(isYouTubeId('-TiFpUYVCHg')).toBe(true);
    expect(isYouTubeId('AUZIYQFzx5_x')).toBe(false);
  });
  it('the security policy allows the player', () => {
    expect(buildCsp('n')).toMatch(/frame-src[^;]*https:\/\/www\.youtube-nocookie\.com/);
  });
  it('decodes the titles YouTube returns', () => {
    expect(decodeEntities('Sony&#39;s 85mm &amp; more')).toBe("Sony's 85mm & more");
  });
});

describe('is the video still playable on our page', () => {
  const answer = (status: number, body: unknown = {}) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  it('ok, blocked from other websites, gone, unclear', async () => {
    answer(200, { title: 'Introducing DJI RS 5', author_name: 'DJI' });
    expect(await checkYouTubeVideo('nCFe2RoQxv0')).toEqual({ status: 'ok', title: 'Introducing DJI RS 5', channel: 'DJI' });
    answer(401);
    expect((await checkYouTubeVideo('Kc1rcGDXVSM')).status).toBe('not_embeddable');
    answer(404);
    expect((await checkYouTubeVideo('s1R2w4c_k1c')).status).toBe('not_found');
    answer(500);
    expect((await checkYouTubeVideo('s1R2w4c_k1c')).status).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await checkYouTubeVideo('s1R2w4c_k1c')).status).toBe('unknown');
  });
});

describe('choosing a video', () => {
  it('searches brand and model when both are known, else the title', () => {
    expect(videoQuery({ title: 'DJI RS 5 Combo Handheld Gimbal', brand: 'DJI', model: 'RS 5' })).toBe('DJI RS 5');
    expect(videoQuery({ title: 'FL-E2 Split Diopter Filter 58mm', brand: 'K&F CONCEPT', model: null })).toBe('FL-E2 Split Diopter Filter 58mm');
  });
  it('the maker\'s channel counts as official', () => {
    expect(looksOfficial('DJI', 'DJI', 'x')).toBe(true);
    expect(looksOfficial('K&F CONCEPT', 'K&F Concept', 'x')).toBe(true);
    expect(looksOfficial('Christopher Frost', 'Sony', 'x')).toBe(false);
  });
  it('only a candidate it was shown can be chosen; 0 or junk means none', () => {
    expect(parseChoice('{"choice": 2, "reason": "Official launch video"}', cands)).toEqual({ index: 1, reason: 'Official launch video' });
    expect(parseChoice('Sure! {"choice": "1", "reason": "Review"} hope that helps', cands).index).toBe(0);
    expect(parseChoice('{"choice": 0, "reason": "none match"}', cands).index).toBeNull();
    expect(parseChoice('{"choice": 7}', cands).index).toBeNull();
    expect(parseChoice('no json', cands).index).toBeNull();
  });
});
