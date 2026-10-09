/**
 * Phase 4 checkout: server-side address verification (AddressPort). The
 * browser's coordinates never price a delivery; the typed address is
 * geocoded on the server, within the provider's usage policy.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_CHECKOUT, STUDIO } from '@/lib/constants';
import {
  addressText,
  addressUserAgent,
  compareHint,
  contactDetails,
  createNominatimAddressPort,
  disabledAddressPort,
  verifiedFromNominatim,
  verifyAddress,
} from '@/lib/delivery/address';

const SANDTON = { lat: '-26.1076', lon: '28.0567', address: { house_number: '1', road: 'Test Road', suburb: 'Sandton', city: 'Johannesburg', state: 'Gauteng', postcode: '2196', country_code: 'za' } };

function fakeFetch(rows: unknown[] | ((n: number) => { ok: boolean; status: number; rows?: unknown[] })) {
  const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
  let t = 0;
  const impl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers, at: t });
    const r = typeof rows === 'function' ? rows(calls.length) : { ok: true, status: 200, rows };
    return { ok: r.ok, status: r.status, json: async () => r.rows ?? [] };
  };
  const clock = {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
  return { impl, calls, clock };
}

describe('AddressPort: Nominatim adapter', () => {
  it('identifies us, asks for South Africa only, and maps a precise result', async () => {
    const f = fakeFetch([SANDTON]);
    const port = createNominatimAddressPort({ fetchImpl: f.impl, now: f.clock.now, sleep: f.clock.sleep });
    const r = await port.geocode('1 Test Road, Sandton, Johannesburg');
    expect(r).toMatchObject({ ok: true, value: { lat: -26.1076, lng: 28.0567, province: 'Gauteng', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196' } });
    const call = f.calls[0];
    expect(call.url).toContain('countrycodes=za');
    expect(call.url).toContain('limit=1');
    expect(call.headers['User-Agent']).toBe(addressUserAgent());
    expect(call.headers['User-Agent']).toContain(STUDIO.email);
    expect(call.headers['User-Agent']).not.toMatch(/node-fetch|undici/i);
  });

  it('waits at least the policy interval between lookups and caches repeats', async () => {
    const f = fakeFetch([SANDTON]);
    const port = createNominatimAddressPort({ fetchImpl: f.impl, now: f.clock.now, sleep: f.clock.sleep });
    await Promise.all([port.geocode('1 Test Road, Sandton'), port.geocode('2 Test Road, Sandton'), port.geocode('3 Test Road, Sandton')]);
    expect(f.calls).toHaveLength(3);
    for (let i = 1; i < f.calls.length; i++) expect(f.calls[i].at - f.calls[i - 1].at).toBeGreaterThanOrEqual(DELIVERY_CHECKOUT.address.minIntervalMs);
    await port.geocode('1 TEST ROAD, Sandton ');
    expect(f.calls).toHaveLength(3);
  });

  it('a suburb or city centre is not an address; another country is refused', () => {
    expect(verifiedFromNominatim({ lat: '-26.1', lon: '28.0', address: { suburb: 'Sandton', state: 'Gauteng', country_code: 'za' } }, 'Sandton')).toBeNull();
    expect(verifiedFromNominatim({ ...SANDTON, address: { ...SANDTON.address, country_code: 'bw' } }, 'x')).toBeNull();
  });

  it('a rate limit or outage is an unknown outcome (try later), not "not found"', async () => {
    const f = fakeFetch(() => ({ ok: false, status: 429 }));
    const port = createNominatimAddressPort({ fetchImpl: f.impl, now: f.clock.now, sleep: f.clock.sleep });
    expect(await port.geocode('1 Test Road, Sandton')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await verifyAddress({ street: '1 Test Road', city: 'Sandton' }, port)).toMatchObject({ ok: false, code: 'ADDRESS_CHECK_UNAVAILABLE' });
  });

  it('switched off: delivery falls back to collection, never to the browser', async () => {
    expect(await verifyAddress({ street: '1 Test Road', city: 'Sandton' }, disabledAddressPort)).toMatchObject({ ok: false, code: 'ADDRESS_CHECK_OFF' });
  });
});

describe('typed address, contact and browser hint', () => {
  it('needs a street number and enough to find it', () => {
    expect(addressText({ street: 'Sandton' })).toMatchObject({ ok: false });
    expect(addressText({ street: '1 Test Road', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196' })).toEqual({
      ok: true,
      text: '1 Test Road, Sandton, Johannesburg, 2196',
      parts: { street: '1 Test Road', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196' },
    });
  });

  it('a browser position far from the verified point is flagged, and only compared', () => {
    const verified = { lat: -26.1076, lng: 28.0567 };
    expect(compareHint(verified, undefined)).toEqual({ provided: false, withinTolerance: true, distanceKm: null });
    expect(compareHint(verified, { lat: -26.108, lng: 28.057 })).toMatchObject({ provided: true, withinTolerance: true });
    // Next to our office instead: about 9 km away.
    expect(compareHint(verified, { lat: STUDIO.fulfilment.dispatchFrom.lat, lng: STUDIO.fulfilment.dispatchFrom.lng })).toMatchObject({ provided: true, withinTolerance: false });
  });

  it('driver contact: a first name and a South African phone number', () => {
    expect(contactDetails({ contact_name: 'Thandi', contact_phone: '+27 82 123 4567' })).toEqual({ ok: true, contactName: 'Thandi', contactPhone: '0821234567', instructions: null });
    expect(contactDetails({ contact_name: 'T', contact_phone: '0821234567' })).toMatchObject({ ok: false });
    expect(contactDetails({ contact_name: 'Thandi', contact_phone: '1234' })).toMatchObject({ ok: false });
  });
});
