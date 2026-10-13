import { STUDIO } from '@/lib/constants';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';

export interface SACity {
  slug: string;
  name: string;
  province: string;
  aliases: string[];
  /** City centre, used to decide whether our delivery reaches it. */
  lat: number;
  lng: number;
}

/**
 * Every city slug the site has ever published. Only the Gauteng ones still
 * have pages (LISTED_CITIES below); the rest are kept so their old URLs can be
 * recognised and redirected (308) to the category page.
 */
export const SA_CITIES: SACity[] = [
  { slug: 'johannesburg', name: 'Johannesburg', province: 'Gauteng', aliases: ['joburg', 'jhb', 'jozi'], lat: -26.2041, lng: 28.0473 },
  { slug: 'cape-town', name: 'Cape Town', province: 'Western Cape', aliases: ['cpt'], lat: -33.9249, lng: 18.4241 },
  { slug: 'durban', name: 'Durban', province: 'KwaZulu-Natal', aliases: ['dbn', 'ethekwini'], lat: -29.8587, lng: 31.0218 },
  { slug: 'pretoria', name: 'Pretoria', province: 'Gauteng', aliases: ['tshwane', 'pta'], lat: -25.7479, lng: 28.2293 },
  { slug: 'port-elizabeth', name: 'Port Elizabeth', province: 'Eastern Cape', aliases: ['gqeberha', 'pe'], lat: -33.9608, lng: 25.6022 },
  { slug: 'bloemfontein', name: 'Bloemfontein', province: 'Free State', aliases: ['bloem'], lat: -29.0852, lng: 26.1596 },
  { slug: 'east-london', name: 'East London', province: 'Eastern Cape', aliases: ['el'], lat: -33.0153, lng: 27.9116 },
  { slug: 'polokwane', name: 'Polokwane', province: 'Limpopo', aliases: ['pietersburg'], lat: -23.9045, lng: 29.4689 },
  { slug: 'nelspruit', name: 'Nelspruit', province: 'Mpumalanga', aliases: ['mbombela'], lat: -25.4753, lng: 30.9694 },
  { slug: 'kimberley', name: 'Kimberley', province: 'Northern Cape', aliases: [], lat: -28.7282, lng: 24.7499 },
  { slug: 'rustenburg', name: 'Rustenburg', province: 'North West', aliases: [], lat: -25.6676, lng: 27.2421 },
  { slug: 'soweto', name: 'Soweto', province: 'Gauteng', aliases: [], lat: -26.2485, lng: 27.854 },
  { slug: 'sandton', name: 'Sandton', province: 'Gauteng', aliases: [], lat: -26.1076, lng: 28.0567 },
  { slug: 'midrand', name: 'Midrand', province: 'Gauteng', aliases: [], lat: -25.9992, lng: 28.1263 },
  { slug: 'centurion', name: 'Centurion', province: 'Gauteng', aliases: [], lat: -25.8603, lng: 28.1894 },
  { slug: 'stellenbosch', name: 'Stellenbosch', province: 'Western Cape', aliases: [], lat: -33.9321, lng: 18.8602 },
  { slug: 'umhlanga', name: 'Umhlanga', province: 'KwaZulu-Natal', aliases: [], lat: -29.7276, lng: 31.0819 },
  { slug: 'pietermaritzburg', name: 'Pietermaritzburg', province: 'KwaZulu-Natal', aliases: ['pmb'], lat: -29.6006, lng: 30.3794 },
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

/**
 * Whether rental stock really reaches this city, from the same data the
 * checkout uses: gear is collected in STUDIO.location.city, and delivery
 * reaches a place when the own-vehicle quote (lib/delivery/quote.ts) can price
 * it, i.e. delivery is on and the road distance from a dispatch point is
 * within STUDIO.fulfilment.delivery.maxRadiusKm. Change the radius, add a
 * dispatch point or switch delivery off and the city pages follow on their
 * own. Rentals have no per-item location, so this holds for every item.
 */
export function rentalsReachCity(city: SACity): boolean {
  if (STUDIO.fulfilment.collection.enabled && city.name === STUDIO.location.city) return true;
  const quote = quoteOwnVehicleCents({ destination: { lat: city.lat, lng: city.lng }, itemCount: 1 });
  return 'feeCents' in quote;
}

/** Listed cities our rental stock reaches (collection or delivery). */
export function getRentalCities(): SACity[] {
  return LISTED_CITIES.filter(rentalsReachCity);
}

/** A rental city for a URL slug, or undefined when the stock does not reach it. */
export function getRentalCityBySlug(slug: string): SACity | undefined {
  return getRentalCities().find((c) => c.slug === slug);
}

/**
 * Whether a creator's stated location is in this city: the city name appears
 * in it, case-insensitive. This is exactly the filter the studio city page
 * runs in the database (getCrewBySpecializationsAndLocation, `ilike
 * %name%`), so the sitemap never lists a city page that would redirect.
 */
export function locationMatchesCity(location: string | null | undefined, city: SACity): boolean {
  if (!location) return false;
  return location.toLowerCase().includes(city.name.toLowerCase());
}
