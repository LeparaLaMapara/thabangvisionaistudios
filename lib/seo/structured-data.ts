import { STUDIO } from '@/lib/constants';

type JsonLd = Record<string, unknown>;

/**
 * Where we work, for every `areaServed`: the province in STUDIO.serviceArea
 * (Gauteng). Outside it, travel is quoted separately, so the country is never
 * claimed as the service area.
 */
export function serviceAreaJsonLd(): JsonLd {
  return {
    '@type': 'AdministrativeArea',
    name: STUDIO.serviceArea.province,
    containedInPlace: { '@type': 'Country', name: STUDIO.location.country },
  };
}

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: STUDIO.name,
    url: STUDIO.meta.url,
    logo: `${STUDIO.meta.url}/logo-black-bg.png`,
    description: STUDIO.meta.description,
    email: STUDIO.supportEmail,
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
    areaServed: serviceAreaJsonLd(),
  };
}

/** Group thousands the SA way, but with an ordinary space. */
function zar(amount: number): string {
  // Built from its code point rather than typed: a bare U+00A0 in source is
  // invisible, and any editor that normalises whitespace would silently turn
  // this into a no-op nobody would notice.
  const NBSP = String.fromCharCode(160);
  return amount.toLocaleString('en-ZA').split(NBSP).join(' ');
}

/**
 * `priceRange` is what Google shows as the business's price band.
 *
 * It was hardcoded to "R1500 - R50000" while hire actually ran R20 to R4500 a
 * day, so search results advertised a floor 75x above the real one. Pass the
 * live range from stock; omit it and the field is left out entirely, which is
 * better than publishing a number that is wrong.
 */
export function localBusinessJsonLd(priceRange?: { min: number; max: number } | null): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${STUDIO.meta.url}/#business`,
    name: STUDIO.name,
    url: STUDIO.meta.url,
    image: `${STUDIO.meta.url}/logo-black-bg.png`,
    description: STUDIO.meta.description,
    email: STUDIO.supportEmail,
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
    // en-ZA groups thousands with a non-breaking space (U+00A0). That is right
    // on a rendered page but this string is read by crawlers, so normalise it
    // to a plain space.
    ...(priceRange
      ? { priceRange: `R${zar(priceRange.min)} - R${zar(priceRange.max)}` }
      : {}),
    areaServed: serviceAreaJsonLd(),
    currenciesAccepted: 'ZAR',
    paymentAccepted: 'Credit Card, Debit Card, EFT',
  };
}

/**
 * Product + Offer for one rental item. The offer is the daily hire price in
 * ZAR. An item without a daily price gets no offer at all: publishing price 0
 * would tell search engines the gear is free.
 */
export function productJsonLd(rental: {
  title: string;
  slug: string;
  category: string;
  categoryLabel?: string | null;
  description?: string | null;
  price_per_day: number | null;
  thumbnail_url?: string | null;
  gallery?: { url?: string | null }[] | null;
  is_available: boolean | null;
  brand?: string | null;
  model?: string | null;
  average_rating?: number | null;
  review_count?: number | null;
}): JsonLd {
  const url = `${STUDIO.meta.url}/rentals/${rental.category}/${rental.slug}`;
  const images = [
    rental.thumbnail_url,
    ...(rental.gallery ?? []).map((g) => g?.url),
  ].filter((u): u is string => typeof u === 'string' && u.length > 0);
  const price = rental.price_per_day;
  const hasPrice = typeof price === 'number' && Number.isFinite(price) && price > 0;
  const rated = (rental.review_count ?? 0) > 0 && (rental.average_rating ?? 0) > 0;
  const amount = hasPrice ? Math.round((price as number) * 100) / 100 : 0;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: rental.title,
    url,
    image: images.length > 0 ? [...new Set(images)].slice(0, 6) : `${STUDIO.meta.url}/logo-black-bg.png`,
    description: rental.description?.trim() || `${rental.title} available for hire at ${STUDIO.name}.`,
    ...(rental.brand ? { brand: { '@type': 'Brand', name: rental.brand } } : {}),
    ...(rental.model ? { model: rental.model } : {}),
    category: rental.categoryLabel ?? rental.category,
    ...(rated
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Math.round((rental.average_rating as number) * 10) / 10,
            reviewCount: rental.review_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(hasPrice
      ? {
          offers: {
            '@type': 'Offer',
            url,
            price: amount,
            priceCurrency: 'ZAR',
            // A hire price is per day, not a sale price.
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: amount,
              priceCurrency: 'ZAR',
              unitCode: 'DAY',
              unitText: 'per day',
              referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' },
            },
            businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
            availability: rental.is_available === false
              ? 'https://schema.org/OutOfStock'
              : 'https://schema.org/InStock',
            areaServed: serviceAreaJsonLd(),
            seller: { '@type': 'Organization', name: STUDIO.name, url: STUDIO.meta.url },
          },
        }
      : {}),
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
      ? { '@type': 'City', name: opts.city, containedInPlace: serviceAreaJsonLd() }
      : serviceAreaJsonLd(),
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

/**
 * A creator as a schema.org Person, at their one canonical address
 * (lib/seo/creator-url.ts). Ratings belong to the person who earned them, so
 * aggregateRating and reviews sit on the Person, not on a business wrapper.
 */
export function personJsonLd(creator: {
  display_name: string | null;
  /** The canonical absolute URL of the profile. */
  url: string;
  specializations?: string[] | null;
  location?: string | null;
  avatar_url?: string | null;
  description?: string | null;
  rating?: {
    ratingValue: number;
    reviewCount: number;
    reviews?: { rating: number; author: string; comment: string | null; date: string }[];
  } | null;
}): JsonLd {
  const rating = creator.rating && creator.rating.reviewCount > 0 ? creator.rating : null;
  const specs = creator.specializations ?? [];
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${creator.url}#person`,
    name: creator.display_name ?? 'Creator',
    url: creator.url,
    ...(creator.avatar_url ? { image: creator.avatar_url } : {}),
    ...(creator.description ? { description: creator.description } : {}),
    jobTitle: specs.join(', ') || 'Creative Professional',
    ...(specs.length > 0 ? { knowsAbout: specs } : {}),
    // Booked through the platform; not an employee of it.
    affiliation: { '@type': 'Organization', name: STUDIO.name, url: STUDIO.meta.url },
    ...(creator.location && {
      address: { '@type': 'PostalAddress', addressLocality: creator.location, addressCountry: 'ZA' },
    }),
    ...(rating && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: rating.ratingValue,
        bestRating: 5,
        worstRating: 1,
        reviewCount: rating.reviewCount,
      },
      ...(rating.reviews && rating.reviews.length > 0 && {
        review: rating.reviews.slice(0, 5).map((r) => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.author },
          reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
          datePublished: r.date.split('T')[0],
          ...(r.comment && { reviewBody: r.comment }),
        })),
      }),
    }),
  };
}

/**
 * A rating for a creator, on its own. It used to be typed LocalBusiness, which
 * told search engines each creator was a separate business. It is now the
 * same Person (same @id as personJsonLd) so the two merge into one entity.
 * Prefer passing `rating` to personJsonLd.
 */
export function aggregateRatingJsonLd(opts: {
  name: string;
  url: string;
  ratingValue: number;
  reviewCount: number;
  reviews?: { rating: number; author: string; comment: string | null; date: string }[];
}): JsonLd {
  const person = personJsonLd({
    display_name: opts.name,
    url: opts.url,
    rating: { ratingValue: opts.ratingValue, reviewCount: opts.reviewCount, reviews: opts.reviews },
  });
  return {
    '@context': person['@context'],
    '@type': 'Person',
    '@id': person['@id'],
    name: person.name,
    url: person.url,
    aggregateRating: person.aggregateRating,
    ...(person.review ? { review: person.review } : {}),
  };
}

/**
 * One free Ubunye app as a SoftwareApplication. `release` comes from the
 * published latest.json (lib/ubunye-release.ts); without one, the version and
 * download fields are left out rather than guessed.
 */
export function softwareApplicationJsonLd(app: {
  name: string;
  description: string;
  url: string;
  applicationCategory: string;
  applicationSubCategory?: string | null;
  operatingSystems: string[];
  image?: string | null;
  license?: string | null;
  author?: string | null;
  codeRepository?: string | null;
  webUrl?: string | null;
  release?: { version: string; published: string; downloadUrls: string[] } | null;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${app.url}#app`,
    name: app.name,
    description: app.description,
    url: app.url,
    applicationCategory: app.applicationCategory,
    ...(app.applicationSubCategory ? { applicationSubCategory: app.applicationSubCategory } : {}),
    operatingSystem: app.operatingSystems.join(', '),
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'ZAR' },
    ...(app.image ? { image: app.image } : {}),
    ...(app.license ? { license: app.license } : {}),
    ...(app.author ? { author: { '@type': 'Organization', name: app.author } } : {}),
    publisher: { '@type': 'Organization', name: STUDIO.name, url: STUDIO.meta.url },
    ...(app.codeRepository ? { sameAs: [app.codeRepository] } : {}),
    ...(app.webUrl ? { installUrl: app.webUrl } : {}),
    ...(app.release
      ? {
          softwareVersion: app.release.version,
          datePublished: app.release.published.split('T')[0],
          ...(app.release.downloadUrls.length > 0 ? { downloadUrl: app.release.downloadUrls } : {}),
        }
      : {}),
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

/**
 * JSON for a `<script type="application/ld+json">` element written with
 * dangerouslySetInnerHTML. Plain JSON.stringify is NOT safe there: a value
 * holding `</script>` (a creator's location, a review) closes the element and
 * the rest runs as script (Phase 6 security finding INJ-1). Escaping `<`, `>`
 * and `&` as \uXXXX keeps the JSON identical to a JSON parser while the HTML
 * parser never sees a tag; U+2028/U+2029 are escaped for old JS parsers.
 * Every JSON-LD caller goes through here.
 */
export function renderJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
