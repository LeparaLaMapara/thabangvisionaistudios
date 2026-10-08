import { STUDIO } from '@/lib/constants';

export interface SACity {
  slug: string;
  name: string;
  province: string;
  aliases: string[];
}

/**
 * Every city slug the site has ever published. Only the Gauteng ones still
 * have pages (LISTED_CITIES below); the rest are kept so their old URLs can be
 * recognised and redirected (308) to the category page.
 */
export const SA_CITIES: SACity[] = [
  { slug: 'johannesburg', name: 'Johannesburg', province: 'Gauteng', aliases: ['joburg', 'jhb', 'jozi'] },
  { slug: 'cape-town', name: 'Cape Town', province: 'Western Cape', aliases: ['cpt'] },
  { slug: 'durban', name: 'Durban', province: 'KwaZulu-Natal', aliases: ['dbn', 'ethekwini'] },
  { slug: 'pretoria', name: 'Pretoria', province: 'Gauteng', aliases: ['tshwane', 'pta'] },
  { slug: 'port-elizabeth', name: 'Port Elizabeth', province: 'Eastern Cape', aliases: ['gqeberha', 'pe'] },
  { slug: 'bloemfontein', name: 'Bloemfontein', province: 'Free State', aliases: ['bloem'] },
  { slug: 'east-london', name: 'East London', province: 'Eastern Cape', aliases: ['el'] },
  { slug: 'polokwane', name: 'Polokwane', province: 'Limpopo', aliases: ['pietersburg'] },
  { slug: 'nelspruit', name: 'Nelspruit', province: 'Mpumalanga', aliases: ['mbombela'] },
  { slug: 'kimberley', name: 'Kimberley', province: 'Northern Cape', aliases: [] },
  { slug: 'rustenburg', name: 'Rustenburg', province: 'North West', aliases: [] },
  { slug: 'soweto', name: 'Soweto', province: 'Gauteng', aliases: [] },
  { slug: 'sandton', name: 'Sandton', province: 'Gauteng', aliases: [] },
  { slug: 'midrand', name: 'Midrand', province: 'Gauteng', aliases: [] },
  { slug: 'centurion', name: 'Centurion', province: 'Gauteng', aliases: [] },
  { slug: 'stellenbosch', name: 'Stellenbosch', province: 'Western Cape', aliases: [] },
  { slug: 'umhlanga', name: 'Umhlanga', province: 'KwaZulu-Natal', aliases: [] },
  { slug: 'pietermaritzburg', name: 'Pietermaritzburg', province: 'KwaZulu-Natal', aliases: ['pmb'] },
];

/**
 * We work in Gauteng (STUDIO.serviceArea); outside the province travel is
 * quoted separately. Collection is in Braamfontein, Johannesburg and delivery
 * reaches about 100 km (STUDIO.fulfilment). Rental and studio city pages exist
 * only for the Gauteng cities below. They are examples of places we serve, not
 * the whole of Gauteng. Every other city slug, and the old "south-africa"
 * country slug, is permanently redirected to the category page: those pages
 * listed Johannesburg stock under another city's name.
 */
export function isInServiceArea(city: SACity): boolean {
  return city.province === STUDIO.serviceArea.province;
}

/** @deprecated Use isInServiceArea; kept for existing callers and tests. */
export const deliversRentals = isInServiceArea;

/** The cities that have rental and studio city pages (Gauteng only). */
export const LISTED_CITIES: SACity[] = SA_CITIES.filter(isInServiceArea);

/** Same list; the original name used by rentals. */
export const RENTAL_CITIES: SACity[] = LISTED_CITIES;

/**
 * The listed (Gauteng) city for a URL slug, or undefined when the slug must
 * not have a page: a city outside Gauteng, the old country slug, or an
 * unknown slug. Callers redirect (308) to the category page in that case.
 */
export function getListedCityBySlug(slug: string): SACity | undefined {
  return LISTED_CITIES.find((c) => c.slug === slug);
}

/** Slugs that have city pages, for generateStaticParams and the sitemap. */
export function getListedCitySlugs(): string[] {
  return LISTED_CITIES.map((c) => c.slug);
}

export const COUNTRY_SLUG = 'south-africa';
export const COUNTRY_NAME = 'South Africa';

export function getCityBySlug(slug: string): SACity | undefined {
  if (slug === COUNTRY_SLUG) return undefined;
  return SA_CITIES.find((c) => c.slug === slug);
}

export function getCitySlugs(): string[] {
  return SA_CITIES.map((c) => c.slug);
}

export function buildLocationPattern(city: SACity): string {
  const terms = [city.name, ...city.aliases].map((t) => t.toLowerCase());
  return terms.join('|');
}
