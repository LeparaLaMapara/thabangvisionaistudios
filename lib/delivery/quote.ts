import { STUDIO } from '@/lib/constants';

export type FulfilmentMethod = 'collection' | 'delivery';

/** How the customer intends to pay. */
export type PaymentPlan = 'full' | 'deposit_only';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DeliveryQuote {
  /** Estimated one-way road distance, in kilometres, rounded to 1dp. */
  distanceKm: number;
  /** Which of our locations the estimate was measured from. */
  fromLocation: string;
  /** The distance component of the fee. */
  distanceFee: number;
  /** The extra charged for a larger load. */
  sizeSurcharge: number;
  /** What the customer pays for delivery. */
  fee: number;
  /** True when the minimum kicked in above the calculated amount. */
  minimumApplied: boolean;
}

/** Reasons a delivery cannot be quoted automatically. */
export type DeliveryUnavailable =
  | { reason: 'disabled' }
  | { reason: 'no_coordinates' }
  | { reason: 'out_of_range'; distanceKm: number; maxRadiusKm: number };

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Straight line, so it always understates a drive. The caller applies
 * STUDIO.fulfilment.delivery.roadDistanceFactor to correct for that.
 */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Every place we can dispatch from. The nearest one to the destination wins.
 *
 * Only the Braamfontein site has coordinates today. When another branch gains
 * its own lat/lng, add it here and the nearest-wins logic picks it up with no
 * other change.
 */
function dispatchPoints(): Array<{ name: string; coords: Coordinates }> {
  const origin = STUDIO.fulfilment.dispatchFrom;
  return [
    {
      name: origin.name,
      coords: { lat: origin.lat, lng: origin.lng },
    },
  ];
}

/**
 * Prices a delivery from the customer's address and the size of their order.
 *
 * Returns either a quote or the reason one cannot be given, so the caller can
 * say something useful instead of failing silently. Pure, so the same function
 * runs in the cart to show a live figure and on the server to charge it — the
 * customer can never be charged a number the server did not calculate itself.
 */
export function quoteDelivery(params: {
  destination: Coordinates | null | undefined;
  /** Total number of items in the order. */
  itemCount: number;
}): DeliveryQuote | DeliveryUnavailable {
  const config = STUDIO.fulfilment.delivery;

  if (!config.enabled) return { reason: 'disabled' };

  const dest = params.destination;
  if (
    !dest ||
    typeof dest.lat !== 'number' ||
    typeof dest.lng !== 'number' ||
    Number.isNaN(dest.lat) ||
    Number.isNaN(dest.lng)
  ) {
    return { reason: 'no_coordinates' };
  }

  // Measure from whichever of our locations is closest.
  const nearest = dispatchPoints()
    .map((p) => ({ ...p, straightLineKm: haversineKm(p.coords, dest) }))
    .sort((a, b) => a.straightLineKm - b.straightLineKm)[0];

  const distanceKm = Math.round(nearest.straightLineKm * config.roadDistanceFactor * 10) / 10;

  if (distanceKm > config.maxRadiusKm) {
    return { reason: 'out_of_range', distanceKm, maxRadiusKm: config.maxRadiusKm };
  }

  const distanceFee = Math.round(distanceKm * config.ratePerKm * 100) / 100;

  const extraItems = Math.max(0, Math.ceil(params.itemCount) - config.itemsIncluded);
  const sizeSurcharge = Math.round(extraItems * config.surchargePerExtraItem * 100) / 100;

  const calculated = Math.round((distanceFee + sizeSurcharge) * 100) / 100;
  const fee = Math.max(config.minimumFee, calculated);

  return {
    distanceKm,
    fromLocation: nearest.name,
    distanceFee,
    sizeSurcharge,
    fee,
    minimumApplied: fee > calculated,
  };
}

/** Narrows a quoteDelivery result. */
export function isDeliveryQuote(
  result: DeliveryQuote | DeliveryUnavailable,
): result is DeliveryQuote {
  return 'fee' in result;
}
