import { DELIVERY_POLICY } from '@/lib/constants';
import type { ProviderCallResult } from '@/lib/core/ports';
import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import {
  parcelUnits,
  type CreateDeliveryRequest,
  type DeliveryPort,
  type DeliveryQuoteRequest,
  type ProviderDelivery,
  type ProviderDeliveryState,
  type ProviderQuote,
  type ServiceabilityRequest,
  type ServiceabilityResult,
  type TrackingResult,
} from '@/lib/core/delivery/port';
import { quoteOwnVehicleCents } from './quote';

/**
 * The manual adapter: our own vehicle and staff (spec Phase 4 §4.4, 4A).
 *
 * Quotes use the existing own-vehicle formula (lib/delivery/quote.ts), in
 * cents, measured from the leg's actual origin. "Dispatch" creates a staff
 * task: no external call is made. Staff then move the leg along from the
 * admin console (advanceManualDelivery, confirmCollection, confirmHandover),
 * with our own handover evidence (photos, renter acceptance in the app).
 *
 * Capabilities are honest:
 *  - scheduled and return pickups: yes (staff drive at an agreed time);
 *  - on demand: no (a person has to be free);
 *  - pickup confirmation / proof of delivery: yes, through our own handover
 *    evidence, not a courier scan;
 *  - hand-to-hand (no leave-at-door): yes, by staff policy;
 *  - idempotent create: yes (unique merchant reference in our own table);
 *  - live tracking, webhooks, signature, PIN, declared value: no;
 *  - verified transit cover: only if the founder approves (DELIVERY_POLICY.ownFleet).
 */

export const MANUAL_PROVIDER_ID = 'manual';

export const OWN_FLEET_CAPABILITIES: DeliveryCapabilities = {
  onDemand: false,
  scheduled: true,
  reverseLogistics: true,
  liveTracking: false,
  trackingWebhooks: false,
  pickupConfirmation: true,
  proofOfDelivery: true,
  signature: false,
  recipientPin: false,
  declaredValueSupport: false,
  verifiedTransitCover: DELIVERY_POLICY.ownFleet.verifiedTransitCover,
  cancellation: true,
  noLeaveAtDoor: true,
  idempotentCreate: true,
};

export interface ManualTask {
  merchantReference: string;
  providerReference: string;
  leg: 'outbound' | 'return';
  state: ProviderDeliveryState;
  windowStart: string | null;
  windowEnd: string | null;
  itemCount: number;
  createdAt: string;
}

/** Where staff tasks live. Unique by merchant reference: creating twice returns the first task. */
export interface ManualTaskStore {
  create(task: ManualTask): Promise<{ task: ManualTask; created: boolean }>;
  findByMerchantReference(merchantReference: string): Promise<ManualTask | null>;
  get(providerReference: string): Promise<ManualTask | null>;
  /** Cancel an unstarted task. Returns null when it is no longer cancellable. */
  cancel(providerReference: string, reason: string): Promise<ManualTask | null>;
}

const ok = <T>(value: T): ProviderCallResult<T> => ({ ok: true, value });
const unknown = (err: unknown): { ok: false; kind: 'unknown'; message: string } => ({ ok: false, kind: 'unknown', message: err instanceof Error ? err.message : 'task store unavailable' });

function toDelivery(t: ManualTask): ProviderDelivery {
  return { providerReference: t.providerReference, merchantReference: t.merchantReference, state: t.state, stateAt: null, trackingUrl: null, courierName: null, proof: [] };
}

export function createManualDeliveryAdapter(store: ManualTaskStore, opts: { now?: () => Date } = {}): DeliveryPort {
  const now = opts.now ?? (() => new Date());

  function price(r: ServiceabilityRequest): ReturnType<typeof quoteOwnVehicleCents> {
    return quoteOwnVehicleCents({
      origin: { name: 'origin', coords: { lat: r.from.lat, lng: r.from.lng } },
      destination: { lat: r.to.lat, lng: r.to.lng },
      // Units, not lines: three tripods on one line are three items (as in lib/cart/pricing.ts).
      itemCount: parcelUnits(r.items),
    });
  }

  return {
    providerId: MANUAL_PROVIDER_ID,
    kind: 'own_fleet',
    mode: 'production',
    capabilities: OWN_FLEET_CAPABILITIES,

    async checkServiceability(r: ServiceabilityRequest): Promise<ProviderCallResult<ServiceabilityResult>> {
      const q = price(r);
      if ('feeCents' in q) return ok({ serviceable: true, reason: null });
      return ok({ serviceable: false, reason: q.reason === 'out_of_range' ? 'out_of_area' : q.reason });
    },

    async quote(r: DeliveryQuoteRequest): Promise<ProviderCallResult<ProviderQuote>> {
      const q = price(r);
      if (!('feeCents' in q)) return { ok: false, kind: 'rejected', message: q.reason };
      return ok({
        providerId: MANUAL_PROVIDER_ID,
        providerQuoteRef: null,
        providerCostCents: q.feeCents,
        expiresAt: new Date(now().getTime() + DELIVERY_POLICY.quoteTtlMinutes * 60_000).toISOString(),
        window: r.window,
      });
    },

    async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
      try {
        const { task } = await store.create({
          merchantReference: r.merchantReference,
          providerReference: `manual-${r.merchantReference}`,
          leg: r.leg,
          state: 'pending',
          windowStart: r.window.start,
          windowEnd: r.window.end,
          itemCount: parcelUnits(r.items),
          createdAt: now().toISOString(),
        });
        return ok(toDelivery(task));
      } catch (err) {
        return unknown(err);
      }
    },

    async findByMerchantReference(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
      try {
        const t = await store.findByMerchantReference(merchantReference);
        return ok(t ? toDelivery(t) : null);
      } catch (err) {
        return unknown(err);
      }
    },

    async getDelivery(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>> {
      try {
        const t = await store.get(providerReference);
        return t ? ok(toDelivery(t)) : { ok: false, kind: 'rejected', message: 'no such task' };
      } catch (err) {
        return unknown(err);
      }
    },

    async cancelDelivery(providerReference: string, reason: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
      try {
        const t = await store.cancel(providerReference, reason);
        // Our own vehicle charges no cancellation fee.
        return ok({ cancelled: t !== null, feeCents: 0 });
      } catch (err) {
        return unknown(err);
      }
    },

    async getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>> {
      try {
        const t = await store.get(providerReference);
        if (!t) return { ok: false, kind: 'rejected', message: 'no such task' };
        // No live location or ETA: we never invent one (spec §4.17).
        return ok({ state: t.state, etaAt: null, location: null, trackingUrl: null });
      } catch (err) {
        return unknown(err);
      }
    },
  };
}

/** In-memory task store (tests, local development). */
export class InMemoryManualTaskStore implements ManualTaskStore {
  tasks = new Map<string, ManualTask>();
  async create(task: ManualTask): Promise<{ task: ManualTask; created: boolean }> {
    const existing = this.tasks.get(task.merchantReference);
    if (existing) return { task: existing, created: false };
    this.tasks.set(task.merchantReference, { ...task });
    return { task: { ...task }, created: true };
  }
  async findByMerchantReference(ref: string): Promise<ManualTask | null> {
    const t = this.tasks.get(ref);
    return t ? { ...t } : null;
  }
  async get(providerReference: string): Promise<ManualTask | null> {
    for (const t of this.tasks.values()) if (t.providerReference === providerReference) return { ...t };
    return null;
  }
  async cancel(providerReference: string): Promise<ManualTask | null> {
    for (const t of this.tasks.values()) {
      if (t.providerReference !== providerReference) continue;
      if (!['pending', 'courier_assigned', 'courier_at_pickup', 'cancelled'].includes(t.state)) return null;
      t.state = 'cancelled';
      return { ...t };
    }
    return null;
  }
}
