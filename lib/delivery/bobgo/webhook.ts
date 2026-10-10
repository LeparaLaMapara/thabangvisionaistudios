import type { DeliveryWebhookParser, ParsedDeliveryEvent } from '../inbox';
import { asIsoTime, asObject, asString } from '../http';
import { BOBGO_CONTRACT, BOBGO_PROVIDER_ID, mapBobgoStatus } from './api-contract';

/**
 * Bob Go webhooks. CLOSED.
 *
 * Bob Go's webhook signing scheme is unknown (api-contract.ts
 * `webhookSigning: null`). No algorithm is guessed here: inventing one would
 * either refuse every real event or, worse, accept a forged one.
 *
 * - `bobgoWebhookParser(env)` (what the parser registry uses) returns null,
 *   so /api/webhooks/delivery/bobgo answers 503 not_configured and nothing is
 *   stored or applied (D11). Status comes from reading the order instead.
 * - `createBobgoWebhookParser({ verify })` exists so that, once Bob Go
 *   documents its scheme in writing, a verifier can be written for exactly
 *   that scheme (with tests) and plugged in. With `verify: null` it refuses
 *   every request.
 */

type Env = Record<string, string | undefined>;
export type BobgoSignatureVerifier = (rawBody: string, headers: Readonly<Record<string, string>>) => boolean;

const F = BOBGO_CONTRACT.fields;

export function createBobgoWebhookParser(opts: { verify: BobgoSignatureVerifier | null }): DeliveryWebhookParser {
  return {
    providerId: BOBGO_PROVIDER_ID,

    verify(rawBody: string, headers: Readonly<Record<string, string>>): boolean {
      if (!opts.verify) return false;
      try {
        return opts.verify(rawBody, headers) === true;
      } catch {
        return false;
      }
    },

    /** [assumed] payload shape: an order (bare or wrapped). Keeps ids, status and time only. */
    parse(rawBody: string): ParsedDeliveryEvent | null {
      let j: unknown;
      try {
        j = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const top = asObject(j);
      const o = F.orderWrappers.map((k) => asObject(top?.[k])).find((x) => x !== null) ?? top;
      if (!o) return null;
      const providerReference = asString(o[F.orderId]);
      const merchantReference = asString(o[F.merchantReference]);
      if (!providerReference && !merchantReference) return null;
      const shipments = o[F.shipments];
      const shipment = Array.isArray(shipments) ? asObject(shipments[0]) : null;
      const status = asString(shipment?.[F.shipmentStatus]) ?? asString(o[F.orderStatus]);
      const stateAt = asIsoTime(o[F.updatedAt]);
      return {
        eventId: null,
        merchantReference,
        providerReference,
        state: mapBobgoStatus(status),
        stateAt,
        trackingUrl: null,
        courierName: null,
        proof: [],
        minimal: { providerReference, merchantReference, status, stateAt },
      };
    },
  };
}

/**
 * The parser for this deployment, for the webhook parser registry: none.
 * No signing scheme is known, so Bob Go webhooks are not accepted (polling instead).
 */
export function bobgoWebhookParser(env: Env = process.env): DeliveryWebhookParser | null {
  void env;
  // BOBGO_CONTRACT.webhookSigning is null: there is nothing to verify with.
  return null;
}
