/**
 * YouTube for rental listings: the addresses we use, a check that a video
 * still exists and may play on other websites, and a search of real videos
 * (YouTube Data API v3, YOUTUBE_API_KEY, restricted to that one API).
 *
 * Embeds use youtube-nocookie.com (no tracking cookie until play). A page
 * never shows an empty box: before play it shows the video's own picture
 * (i.ytimg.com) and a "Watch on YouTube" link that works whatever happens
 * to the embedded player (Google sometimes answers an embed with a robot
 * check, which a website is not allowed to show in a frame).
 */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isYouTubeId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export const youtubeEmbedUrl = (id: string, autoplay = false): string =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${autoplay ? '&autoplay=1' : ''}`;
export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
export const youtubePosterUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export type VideoCheck =
  | { status: 'ok'; title: string; channel: string }
  /** The uploader switched off playing on other websites: it cannot be shown here. */
  | { status: 'not_embeddable' }
  /** Deleted, private or never existed. */
  | { status: 'not_found' }
  /** YouTube did not answer clearly: treat as fine, check again later. */
  | { status: 'unknown' };

/** Does this video exist, and may it play on our pages? (oEmbed: no key, no quota.) */
export async function checkYouTubeVideo(id: string, init?: RequestInit & { next?: { revalidate?: number } }): Promise<VideoCheck> {
  if (!isYouTubeId(id)) return { status: 'not_found' };
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(id))}`,
      { signal: AbortSignal.timeout(5_000), ...init },
    );
    if (res.status === 401 || res.status === 403) return { status: 'not_embeddable' };
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    if (!res.ok) return { status: 'unknown' };
    const j = (await res.json()) as { title?: string; author_name?: string };
    return { status: 'ok', title: String(j.title ?? ''), channel: String(j.author_name ?? '') };
  } catch {
    return { status: 'unknown' };
  }
}

export interface YouTubeCandidate {
  id: string;
  title: string;
  channel: string;
  description: string;
}

export function youtubeSearchConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

/**
 * Real videos for a query, only ones that allow playing on other websites.
 * One call costs 100 of the 10,000 free daily quota units.
 */
export async function searchYouTube(query: string, max = 8): Promise<YouTubeCandidate[]> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  const params: Record<string, string> = {
    part: 'snippet',
    q: query.slice(0, 200),
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: String(Math.min(Math.max(max, 1), 15)),
    regionCode: 'ZA',
    relevanceLanguage: 'en',
    safeSearch: 'strict',
    key,
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`YouTube search failed (${res.status}): ${body?.error?.message ?? 'no detail'}`);
  }
  const j = (await res.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; description?: string } }[] };
  return (j.items ?? [])
    .filter((it) => isYouTubeId(it.id?.videoId))
    .map((it) => ({
      id: it.id!.videoId!,
      title: decodeEntities(it.snippet?.title ?? ''),
      channel: decodeEntities(it.snippet?.channelTitle ?? ''),
      description: decodeEntities(it.snippet?.description ?? '').slice(0, 300),
    }));
}

/** YouTube returns titles with HTML entities (&#39;, &amp;). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
