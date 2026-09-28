import { STUDIO } from '@/lib/constants';

/** Where gear is collected, as customers read it: "99 Smith Street, Braamfontein". */
export function collectionPoint(): string {
  const f = STUDIO.fulfilment.dispatchFrom;
  return [f.meetingPoint, f.name].filter(Boolean).join(', ');
}

/** The same, with the city: "99 Smith Street, Braamfontein, Johannesburg". */
export function collectionPointWithCity(): string {
  return `${collectionPoint()}, ${STUDIO.location.city}`;
}
