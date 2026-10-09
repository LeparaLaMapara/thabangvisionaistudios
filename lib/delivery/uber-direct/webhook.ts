import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeliveryWebhookParser, ParsedDeliveryEvent } from '../inbox';
import { asIsoTime, asObject, asString, firstNameOnly } from '../http';
import { UBER_DIRECT_API, UBER_DIRECT_PROVIDER_ID, mapUberStatus } from './api';
import { uberProofs } from './adapter';

/**
 * Uber Direct webhook parser (spec §4.15–4.16, D11).
 *
 * verify: HMAC-SHA256 over the RAW body with our webhook signing key, hex,
 * in `x-uber-signature` (or `x-postmates-signature`), compared in constant
 * time. No key configured → every request is refused (fail closed).
 *
 * parse: only delivery status events. Keeps ids, state, timestamps, the
 * tracking link, the courier's first name and proof REFERENCES. Addresses,
 * phone numbers, signer names, image URLs and courier location are dropped.
 * An event whose live/test flag does not match our mode is ignored, so a
 * sandbox event can never move a production shipment.
 */

type Env = Record<string, string | undefined>;
type Mode = 'sandbox' | 'production';

export function createUberDirectWebhookParser(opts: { signingKey: string | null; mode: Mode }): DeliveryWebhookParser {
  return {
    providerId: UBER_DIRECT_PROVIDER_ID,

    verify(rawBody: string, headers: Readonly<Record<string, string>>): boolean {
      if (!opts.signingKey) return false;
      const given = signatureHeader(headers);
      if (!given || !/^[0-9a-f]+$/i.test(given)) return false;
      const expected = createHmac('sha256', opts.signingKey).update(rawBody, 'utf8').digest();
      const got = Buffer.from(given, 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    },

    parse(rawBody: string): ParsedDeliveryEvent | null {
      let j: unknown;
      try {
        j = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const e = asObject(j);
      if (!e) return null;
      // VERIFY: event kind name. Courier location updates and other kinds are not stored.
      if (asString(e.kind) !== UBER_DIRECT_API.statusEventKind) return null;
      const liveMode = typeof e.live_mode === 'boolean' ? e.live_mode : null;
      if (liveMode !== null && liveMode !== (opts.mode === 'production')) return null;
      const data = asObject(e.data) ?? {};
      const deliveryId = asString(e.delivery_id) ?? asString(data.id);
      const merchantReference = asString(data.external_id);
      if (!deliveryId && !merchantReference) return null;
      const status = asString(e.status) ?? asString(data.status);
      const state = mapUberStatus(status);
      const stateAt = asIsoTime(e.created) ?? asIsoTime(data.updated);
      const eventId = asString(e.id) ?? asString(e.event_id);
      return {
        eventId,
        merchantReference,
        providerReference: deliveryId,
        state,
        stateAt,
        trackingUrl: asString(data.tracking_url),
        courierName: firstNameOnly(asObject(data.courier)?.name),
        proof: deliveryId ? uberProofs(deliveryId, data) : [],
        minimal: {
          kind: asString(e.kind),
          eventId,
          deliveryId,
          externalId: merchantReference,
          status,
          liveMode,
          created: stateAt,
        },
      };
    },
  };
}

function signatureHeader(headers: Readonly<Record<string, string>>): string | null {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  for (const h of UBER_DIRECT_API.signatureHeaders) {
    const v = lower.get(h)?.trim();
    if (v) return v;
  }
  return null;
}

/**
 * The parser for this deployment, for the webhook parser registry.
 * Signing key per mode: UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY (sandbox) or
 * UBER_DIRECT_WEBHOOK_SIGNING_KEY (production); mode from
 * DELIVERY_PROVIDER_UBER_DIRECT_MODE (default production).
 */
export function uberDirectWebhookParser(env: Env = process.env): DeliveryWebhookParser {
  const mode: Mode = (env.DELIVERY_PROVIDER_UBER_DIRECT_MODE ?? 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const key = (mode === 'sandbox' ? env.UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY : env.UBER_DIRECT_WEBHOOK_SIGNING_KEY)?.trim() || null;
  return createUberDirectWebhookParser({ signingKey: key, mode });
}
