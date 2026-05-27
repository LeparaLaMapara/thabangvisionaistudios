import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

interface PageMetaOpts {
  title: string;
  description: string;
  path: string;
  imageUrl?: string;
  imageAlt?: string;
  type?: 'website' | 'article' | 'product';
  noIndex?: boolean;
}

export function buildPageMetadata(opts: PageMetaOpts): Metadata {
  const url = `${STUDIO.meta.url}${opts.path}`;
  const image = opts.imageUrl ?? `${STUDIO.meta.url}/logo-black-bg.png`;
  const imageAlt = opts.imageAlt ?? opts.title;

  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
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
