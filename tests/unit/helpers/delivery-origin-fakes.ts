/**
 * Phase 8 fakes: a mixed order (one studio item, one item from owner A, one
 * from owner B), the owners' pickup addresses, and an in-memory origin port
 * that answers like lib/delivery/origins.ts (core ownerPickupDecision over
 * listing/owner/address facts). Test doubles.
 */
import { ownerPickupDecision, type OwnerPickupDecision, type OwnerPickupFacts } from '@/lib/core/delivery/origin';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { DeliveryOriginPort } from '@/lib/core/delivery/repository';
import type { DeliveryLineInput } from '@/lib/core/delivery/use-cases';
import type { QuoteLinkStore } from '@/lib/delivery/checkout';
import { GROUP, OWNER_A, OWNER_B, RENTER, line, world, type World } from './delivery-fakes';

export const PICK_A = 'addr-owner-a';
export const PICK_B = 'addr-owner-b';
export const STUDIO_CAM = 'cam-studio';
export const LENS_A = 'lens-a';
export const LIGHT_B = 'light-b';

export class FakeOrigins implements DeliveryOriginPort {
  facts = new Map<string, OwnerPickupFacts>();
  calls = 0;
  async originsFor(rentalIds: readonly string[]): Promise<Map<string, OwnerPickupDecision>> {
    this.calls += 1;
    const out = new Map<string, OwnerPickupDecision>();
    for (const r of rentalIds) {
      const f = this.facts.get(r);
      if (f) out.set(r, ownerPickupDecision(f, { enabled: true, serviceProvince: 'Gauteng' }));
    }
    return out;
  }
  set(rentalId: string, patch: Partial<OwnerPickupFacts>): void {
    const f = this.facts.get(rentalId);
    if (f) this.facts.set(rentalId, { ...f, ...patch });
  }
}

export interface OriginWorld extends World {
  origins: FakeOrigins;
  links: QuoteLinkStore;
}

const ownerFacts = (ownerId: string, addressId: string): OwnerPickupFacts => ({
  community: true,
  ownerId,
  listingLive: true,
  listingOptIn: true,
  ownerVerified: true,
  ownerSuspended: false,
  address: { id: addressId, province: 'Gauteng' },
});

/** A paid order: a studio camera, owner A's lens and owner B's light, all collected from where they live. */
export function originWorld(): OriginWorld {
  const w = world({ providers: 'manual' }) as OriginWorld;
  w.addresses.points.set(PICK_A, { placeId: PICK_A, lat: -26.1777, lng: 27.9996, formattedAddress: '7 Owner Lane, Melville', suburb: 'Melville', city: 'Johannesburg', postalCode: '2092', province: 'Gauteng', contactName: 'Ayanda', contactPhone: '0820000003', instructions: 'Ring twice', userId: OWNER_A });
  w.addresses.points.set(PICK_B, { placeId: PICK_B, lat: -25.7479, lng: 28.2293, formattedAddress: '9 Owner Road, Hatfield', suburb: 'Hatfield', city: 'Pretoria', postalCode: '0083', province: 'Gauteng', contactName: 'Bongani', contactPhone: '0820000004', instructions: null, userId: OWNER_B });
  w.bookings.groups.set(GROUP, {
    bookingGroupId: GROUP,
    renterId: RENTER,
    paymentVerified: true,
    paymentReference: 'pay-ref-1',
    lines: [
      line({ bookingId: 'bk-s', rentalId: STUDIO_CAM, ownerId: null, unitReplacementValueCents: 1_000_000 }),
      line({ bookingId: 'bk-a', rentalId: LENS_A, ownerId: OWNER_A, unitReplacementValueCents: 800_000 }),
      line({ bookingId: 'bk-b', rentalId: LIGHT_B, ownerId: OWNER_B, unitReplacementValueCents: 600_000 }),
    ],
  });
  w.origins = new FakeOrigins();
  w.origins.facts.set(STUDIO_CAM, { community: false, ownerId: null, listingLive: true, listingOptIn: false, ownerVerified: false, ownerSuspended: false, address: null });
  w.origins.facts.set(LENS_A, ownerFacts(OWNER_A, PICK_A));
  w.origins.facts.set(LIGHT_B, ownerFacts(OWNER_B, PICK_B));
  w.deps.origins = w.origins;
  w.links = {
    async linkToGroup(quoteId: string, groupId: string) {
      const q = w.repo.quotes.get(quoteId);
      if (!q || q.status !== 'active' || (q.bookingGroupId !== null && q.bookingGroupId !== groupId)) return false;
      q.bookingGroupId = groupId;
      return true;
    },
    async quotesForGroup(groupId: string): Promise<CustomerDeliveryQuote[]> {
      return [...w.repo.quotes.values()].filter((q) => q.bookingGroupId === groupId && q.status !== 'superseded').map((q) => ({ ...q }));
    },
    async available() {
      return true;
    },
  };
  return w;
}

export const MIXED_LINES: DeliveryLineInput[] = [
  { rentalId: STUDIO_CAM, bookingId: 'bk-s', unitReplacementValueCents: 1_000_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: null, containsLithium: true },
  { rentalId: LENS_A, bookingId: 'bk-a', unitReplacementValueCents: 800_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: null, containsLithium: true },
  { rentalId: LIGHT_B, bookingId: 'bk-b', unitReplacementValueCents: 600_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: null, containsLithium: true },
];

export const OUT_WINDOW = { start: '2026-10-20T06:00:00.000Z', end: '2026-10-20T10:00:00.000Z' };
export const BACK_WINDOW = { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T15:00:00.000Z' };
