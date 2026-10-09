/**
 * Fakes for the Phase 4 checkout routes: the delivery world from
 * delivery-fakes.ts (own vehicle only, courier off as in production), plus an
 * in-memory quote link store, address writer and geocoder. Test doubles.
 */
import type { AddressPort } from '@/lib/core/delivery/port';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { RenterAddressInput } from '@/lib/delivery/address-store';
import type { VerifiedAddress } from '@/lib/delivery/address';
import { OFFICE, world, type World } from './delivery-fakes';

export const SANDTON: VerifiedAddress = {
  lat: -26.1076,
  lng: 28.0567,
  formattedAddress: '1 Test Road, Sandton, Johannesburg',
  suburb: 'Sandton',
  city: 'Johannesburg',
  postalCode: '2196',
  province: 'Gauteng',
};

export const PRETORIA_NORTH: VerifiedAddress = {
  lat: -25.6737,
  lng: 28.1734,
  formattedAddress: '5 Far Street, Pretoria North',
  suburb: 'Pretoria North',
  city: 'Pretoria',
  postalCode: '0182',
  province: 'Gauteng',
};

export const DURBAN: VerifiedAddress = { lat: -29.8587, lng: 31.0218, formattedAddress: '1 Beach Road, Durban', suburb: 'Durban Central', city: 'Durban', postalCode: '4001', province: 'KwaZulu-Natal' };

export interface CheckoutWorld extends World {
  geocoded: VerifiedAddress | null;
  geocodeCalls: string[];
  geocoder: AddressPort;
  links: {
    linkToGroup(quoteId: string, groupId: string): Promise<boolean>;
    quotesForGroup(groupId: string): Promise<CustomerDeliveryQuote[]>;
    available(): Promise<boolean>;
  };
  migrationApplied: boolean;
  writer: { saveRenterAddress(p: RenterAddressInput): Promise<string>; platformSiteId(): Promise<string> };
}

export function checkoutWorld(): CheckoutWorld {
  const w = world({ providers: 'manual' }) as CheckoutWorld;
  w.geocoded = SANDTON;
  w.geocodeCalls = [];
  w.migrationApplied = true;
  w.geocoder = {
    providerId: 'fake_geocoder',
    async geocode(text: string) {
      w.geocodeCalls.push(text);
      return { ok: true, value: w.geocoded ? { ...w.geocoded, formattedAddress: text } : null };
    },
  };
  let n = 0;
  w.writer = {
    async saveRenterAddress(p) {
      const id = `addr-new-${++n}`;
      w.addresses.points.set(id, { ...p.address, placeId: id, userId: p.userId, contactName: p.contactName, contactPhone: p.contactPhone, instructions: p.instructions });
      return id;
    },
    async platformSiteId() {
      return OFFICE;
    },
  };
  w.links = {
    async linkToGroup(quoteId, groupId) {
      const q = w.repo.quotes.get(quoteId);
      if (!q || q.status !== 'active' || (q.bookingGroupId !== null && q.bookingGroupId !== groupId)) return false;
      q.bookingGroupId = groupId;
      return true;
    },
    async quotesForGroup(groupId) {
      return [...w.repo.quotes.values()].filter((q) => q.bookingGroupId === groupId).map((q) => ({ ...q }));
    },
    async available() {
      return w.migrationApplied;
    },
  };
  return w;
}
