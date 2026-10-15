import { STUDIO } from '@/lib/constants';

/**
 * Where gear is collected. Two versions on purpose: the collection point is a
 * residential estate where the gear is kept, so public pages, search results
 * and Ubunye name only the area, and the exact place goes only to someone
 * with a booking (confirmation, reminder, their booking page).
 */

/** The area, for anyone: "Dainfern, Fourways". */
export function collectionPoint(): string {
  return STUDIO.fulfilment.dispatchFrom.name;
}

/** The area with the city: "Dainfern, Fourways, Johannesburg". */
export function collectionPointWithCity(): string {
  return `${collectionPoint()}, ${STUDIO.location.city}`;
}

/** The exact place, for a booked customer only: "The View, Dainfern, Fourways". */
export function exactCollectionPoint(): string {
  const f = STUDIO.fulfilment.dispatchFrom;
  return [f.meetingPoint, f.name].filter(Boolean).join(', ');
}

/** The exact place with the city, for a booked customer only. */
export function exactCollectionPointWithCity(): string {
  return `${exactCollectionPoint()}, ${STUDIO.location.city}`;
}

/**
 * The heading of a rentals city page (clarity audit C7). The gear is not in
 * that city: it is collected at our one collection point, or delivered once a
 * first hire is done (city pages exist only where delivery reaches). So:
 * "Cameras & Optics for Soweto shoots", "collected in Dainfern, Fourways or
 * delivered".
 */
export function cityPageHeading(categoryLabel: string, city: string): { title: string; rest: string } {
  return { title: `${categoryLabel} for ${city} shoots`, rest: `collected in ${collectionPoint()} or delivered` };
}
