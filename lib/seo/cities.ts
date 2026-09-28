export interface SACity {
  slug: string;
  name: string;
  province: string;
  aliases: string[];
}

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
 * Where gear can actually be collected or delivered: collection is in
 * Braamfontein, Johannesburg and delivery reaches about 100 km
 * (STUDIO.fulfilment), which is the Gauteng cities. Rental pages for other
 * cities listed Johannesburg stock under "Rentals in Cape Town"; they now
 * point to the category page instead. Studio city pages follow the same rule
 * since 2026-09-28: no creators are listed anywhere, so a "Photography in
 * Cape Town" page promised what does not exist. The city pages are kept for
 * search only; no visible page links to them, and there is no
 * "All South Africa" page.
 */
export function deliversRentals(city: SACity): boolean {
  return city.province === 'Gauteng';
}

export const RENTAL_CITIES: SACity[] = SA_CITIES.filter(deliversRentals);

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
