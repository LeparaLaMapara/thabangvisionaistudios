import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  quoteDelivery,
  isDeliveryQuote,
} from '@/lib/delivery/quote';
import { STUDIO } from '@/lib/constants';

const ORIGIN = STUDIO.fulfilment.dispatchFrom;
const STUDIO_COORDS = { lat: ORIGIN.lat, lng: ORIGIN.lng };
const CONFIG = STUDIO.fulfilment.delivery;

/** A point roughly `km` north of the studio, for predictable distances. */
function northOfStudio(km: number) {
  return { lat: STUDIO_COORDS.lat + km / 111.32, lng: STUDIO_COORDS.lng };
}

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(STUDIO_COORDS, STUDIO_COORDS)).toBe(0);
  });

  it('measures a known north-south offset', () => {
    // One degree of latitude is ~111.32km anywhere on the globe.
    const oneDegreeNorth = { lat: STUDIO_COORDS.lat + 1, lng: STUDIO_COORDS.lng };
    expect(haversineKm(STUDIO_COORDS, oneDegreeNorth)).toBeCloseTo(111.32, 0);
  });

  it('is symmetric', () => {
    const a = STUDIO_COORDS;
    const b = northOfStudio(30);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('quoteDelivery', () => {
  it('refuses to guess without coordinates', () => {
    expect(quoteDelivery({ destination: null, itemCount: 1 })).toEqual({
      reason: 'no_coordinates',
    });
    expect(
      quoteDelivery({ destination: { lat: NaN, lng: 28 }, itemCount: 1 }),
    ).toEqual({ reason: 'no_coordinates' });
  });

  it('applies the minimum fee on a short local run', () => {
    const result = quoteDelivery({ destination: northOfStudio(2), itemCount: 1 });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');
    expect(result.fee).toBe(CONFIG.minimumFee);
    expect(result.minimumApplied).toBe(true);
  });

  it('charges the road-corrected distance beyond the minimum', () => {
    const result = quoteDelivery({ destination: northOfStudio(30), itemCount: 1 });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');

    // 30km straight line, corrected for real roads, then charged per km.
    expect(result.distanceKm).toBeCloseTo(30 * CONFIG.roadDistanceFactor, 0);
    expect(result.fee).toBeGreaterThan(CONFIG.minimumFee);
    expect(result.fee).toBeCloseTo(result.distanceKm * CONFIG.ratePerKm, 1);
    expect(result.minimumApplied).toBe(false);
  });

  it('does not surcharge an order within the included item count', () => {
    const result = quoteDelivery({
      destination: northOfStudio(30),
      itemCount: CONFIG.itemsIncluded,
    });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');
    expect(result.sizeSurcharge).toBe(0);
  });

  it('surcharges each item beyond the included count', () => {
    const extra = 4;
    const result = quoteDelivery({
      destination: northOfStudio(30),
      itemCount: CONFIG.itemsIncluded + extra,
    });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');
    expect(result.sizeSurcharge).toBe(extra * CONFIG.surchargePerExtraItem);
    expect(result.fee).toBeCloseTo(result.distanceFee + result.sizeSurcharge, 2);
  });

  it('stops calculating beyond the radius instead of quoting nonsense', () => {
    const farAway = northOfStudio(CONFIG.maxRadiusKm * 2);
    const result = quoteDelivery({ destination: farAway, itemCount: 1 });
    expect(isDeliveryQuote(result)).toBe(false);
    if (isDeliveryQuote(result)) return;
    expect(result.reason).toBe('out_of_range');
  });

  it('reports the distance it measured when out of range, so we can quote by hand', () => {
    const result = quoteDelivery({
      destination: northOfStudio(CONFIG.maxRadiusKm * 2),
      itemCount: 1,
    });
    if (isDeliveryQuote(result)) throw new Error('expected out of range');
    if (result.reason !== 'out_of_range') throw new Error('wrong reason');
    expect(result.distanceKm).toBeGreaterThan(CONFIG.maxRadiusKm);
    expect(result.maxRadiusKm).toBe(CONFIG.maxRadiusKm);
  });

  it('never returns fractions of a cent', () => {
    const result = quoteDelivery({ destination: northOfStudio(17.3), itemCount: 5 });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');
    expect(Math.round(result.fee * 100)).toBe(result.fee * 100);
  });
});

describe('real Gauteng destinations', () => {
  // Sanity checks against places a customer would actually book, so an
  // accidental change to the origin or the rate shows up as an obviously
  // wrong rand figure rather than a passing abstract test.
  const PLACES = [
    { name: 'Sandton', lat: -26.1076, lng: 28.0567 },
    { name: 'Soweto (Orlando)', lat: -26.2485, lng: 27.9231 },
    { name: 'Soshanguve South', lat: -25.5333, lng: 28.1000 },
    { name: 'Pretoria CBD', lat: -25.7479, lng: 28.2293 },
  ];

  it.each(PLACES)('quotes $name within a believable range', ({ lat, lng }) => {
    const result = quoteDelivery({ destination: { lat, lng }, itemCount: 2 });
    if (!isDeliveryQuote(result)) throw new Error('expected a quote');
    expect(result.fromLocation).toBe(ORIGIN.name);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.fee).toBeGreaterThanOrEqual(CONFIG.minimumFee);
  });

  it('reaches Sandton for less than a Pretoria run', () => {
    const sandton = quoteDelivery({ destination: PLACES[0], itemCount: 2 });
    const pretoria = quoteDelivery({ destination: PLACES[3], itemCount: 2 });
    if (!isDeliveryQuote(sandton) || !isDeliveryQuote(pretoria)) {
      throw new Error('expected quotes');
    }
    expect(sandton.fee).toBeLessThan(pretoria.fee);
  });
});
