import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

interface PageMetaOpts {
  title: string;
  description: string;
  path: string;
  imageUrl?: string;
  imageAlt?: string;
  type?: 'website' | 'article' | 'product';
  ogType?: string;
  noIndex?: boolean;
  /**
   * The page has a markdown twin at <path>.md (lib/discovery/markdown.ts):
   * advertise it with <link rel="alternate" type="text/markdown">.
   */
  markdown?: boolean;
}

function buildOgImageUrl(title: string, subtitle?: string, type?: string): string {
  const params = new URLSearchParams({ title });
  if (subtitle) params.set('subtitle', subtitle);
  if (type) params.set('type', type);
  return `${STUDIO.meta.url}/api/og?${params.toString()}`;
}

export function buildPageMetadata(opts: PageMetaOpts): Metadata {
  const url = `${STUDIO.meta.url}${opts.path}`;
  const image = opts.imageUrl ?? buildOgImageUrl(opts.title, undefined, opts.ogType);
  const imageAlt = opts.imageAlt ?? opts.title;

  return {
    title: opts.title,
    description: opts.description,
    // Setting alternates replaces the root layout's, so the RSS link is
    // repeated here or every page with a canonical would lose it.
    alternates: {
      canonical: url,
      types: {
        'application/rss+xml': `${STUDIO.meta.url}/feed.xml`,
        ...(opts.markdown && opts.path !== '/' ? { 'text/markdown': `${url}.md` } : {}),
      },
    },
    ...(opts.noIndex && { robots: { index: false, follow: true } }),
    openGraph: {
      type: (opts.type ?? 'website') as 'website',
      url,
      title: opts.title,
      description: opts.description,
      siteName: STUDIO.shortName,
      locale: 'en_ZA',
      images: [{ url: image, alt: imageAlt, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [image],
    },
  };
}

/**
 * A search-result description from free text: whitespace collapsed and cut at
 * a word boundary near `max` characters. Falls back when the text is empty.
 */
export function metaDescription(text: string | null | undefined, fallback: string, max = 160): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}
