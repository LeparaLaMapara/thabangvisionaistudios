import { STUDIO, PRODUCTION_SERVICES } from '@/lib/constants';

type JsonLd = Record<string, unknown>;

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: STUDIO.name,
    url: STUDIO.meta.url,
    logo: `${STUDIO.meta.url}/logo-black-bg.png`,
    description: STUDIO.meta.description,
    email: STUDIO.supportEmail,
    telephone: STUDIO.phone,
    address: {
      '@type': 'PostalAddress',
      addressLocality: STUDIO.location.city,
      addressRegion: STUDIO.location.province,
      addressCountry: 'ZA',
    },
    sameAs: [
      STUDIO.social?.instagram,
      STUDIO.social?.youtube,
      STUDIO.social?.twitter,
      STUDIO.social?.facebook,
      STUDIO.social?.linkedin,
    ].filter(Boolean),
    areaServed: {
      '@type': 'Country',
      name: 'South Africa',
    },
  };
}

export function localBusinessJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${STUDIO.meta.url}/#business`,
    name: STUDIO.name,
    url: STUDIO.meta.url,
    image: `${STUDIO.meta.url}/logo-black-bg.png`,
    description: STUDIO.meta.description,
    email: STUDIO.supportEmail,
    telephone: STUDIO.phone,
    address: {
      '@type': 'PostalAddress',
      addressLocality: STUDIO.location.city,
      addressRegion: STUDIO.location.province,
      addressCountry: 'ZA',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: STUDIO.location.lat,
      longitude: STUDIO.location.lng,
    },
    priceRange: 'R1500 - R50000',
    currenciesAccepted: 'ZAR',
    paymentAccepted: 'Credit Card, Debit Card, EFT',
  };
}

export function productJsonLd(rental: {
  title: string;
  slug: string;
  category: string;
  description?: string | null;
  price_per_day: number | null;
  thumbnail_url?: string | null;
  is_available: boolean;
  brand?: string | null;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: rental.title,
    url: `${STUDIO.meta.url}/rentals/${rental.category}/${rental.slug}`,
    image: rental.thumbnail_url ?? `${STUDIO.meta.url}/logo-black-bg.png`,
    description: rental.description ?? `${rental.title} available for hire at ThabangVision.`,
    brand: rental.brand ? { '@type': 'Brand', name: rental.brand } : undefined,
    category: rental.category,
    offers: {
      '@type': 'Offer',
      price: rental.price_per_day ?? 0,
      priceCurrency: 'ZAR',
      unitText: 'per day',
      availability: rental.is_available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: STUDIO.name },
    },
  };
}

export function serviceJsonLd(opts: {
  name: string;
  description: string;
  url: string;
  startingRate?: number;
  imageUrl?: string;
  city?: string;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: opts.name,
    url: opts.url,
    description: opts.description,
    image: opts.imageUrl ?? `${STUDIO.meta.url}/logo-black-bg.png`,
    provider: {
      '@type': 'Organization',
      name: STUDIO.name,
      url: STUDIO.meta.url,
    },
    areaServed: opts.city
      ? { '@type': 'City', name: opts.city }
      : { '@type': 'Country', name: 'South Africa' },
    ...(opts.startingRate && {
      offers: {
        '@type': 'Offer',
        price: opts.startingRate,
        priceCurrency: 'ZAR',
        unitText: 'per session',
      },
    }),
  };
}

export function personJsonLd(creator: {
  display_name: string | null;
  crew_slug: string | null;
  specializations?: string[] | null;
  hourly_rate?: number | null;
  location?: string | null;
  avatar_url?: string | null;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: creator.display_name ?? 'Creator',
    url: creator.crew_slug ? `${STUDIO.meta.url}/studio/category/photography/${creator.crew_slug}` : undefined,
    image: creator.avatar_url ?? undefined,
    jobTitle: (creator.specializations ?? []).join(', ') || 'Creative Professional',
    worksFor: { '@type': 'Organization', name: STUDIO.name },
    ...(creator.location && {
      address: { '@type': 'PostalAddress', addressLocality: creator.location, addressCountry: 'ZA' },
    }),
  };
}

export function aggregateRatingJsonLd(opts: {
  name: string;
  url: string;
  ratingValue: number;
  reviewCount: number;
  reviews?: { rating: number; author: string; comment: string | null; date: string }[];
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: opts.name,
    url: opts.url,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: opts.ratingValue,
      bestRating: 5,
      worstRating: 1,
      reviewCount: opts.reviewCount,
    },
    ...(opts.reviews && opts.reviews.length > 0 && {
      review: opts.reviews.slice(0, 5).map((r) => ({
        '@type': 'Review',
        author: { '@type': 'Person', name: r.author },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: r.rating,
          bestRating: 5,
        },
        datePublished: r.date.split('T')[0],
        ...(r.comment && { reviewBody: r.comment }),
      })),
    }),
  };
}

export function faqPageJsonLd(
  questions: { question: string; answer: string }[],
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function renderJsonLd(data: JsonLd): string {
  return JSON.stringify(data);
}
