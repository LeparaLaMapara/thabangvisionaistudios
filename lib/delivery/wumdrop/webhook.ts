import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeliveryWebhookParser, ParsedDeliveryEvent } from '../inbox';
import { asIsoTime, asObject, asString } from '../http';
import { WUMDROP_PROVIDER_ID, mapWumdropStatus } from './api';

/**
 * WumDrop webhook parser. FAILS CLOSED.
 *
 * WumDrop's webhook signing is not verified (provider-comparison.md: "signing
 * NV"), so by default verify() refuses EVERY request: an unsigned status
 * update is never stored or applied (D11). Status comes from polling
 * getDelivery / findByMerchantReference instead.
 *
 * Once WumDrop confirms a signing scheme in writing, pass it here as
 * `scheme` (header name and shared secret; HMAC-SHA256 hex over the raw body
 * is the only algorithm implemented, so a different scheme needs code).
 */

type Env = Record<string, string | undefined>;

export interface WumdropSigningScheme {
  algorithm: 'hmac-sha256-hex';
  header: string;
  secret: string;
}

export function createWumdropWebhookParser(opts: { scheme: WumdropSigningScheme | null }): DeliveryWebhookParser {
  return {
    providerId: WUMDROP_PROVIDER_ID,

    verify(rawBody: string, headers: Readonly<Record<string, string>>): boolean {
      const s = opts.scheme;
      if (!s || s.algorithm !== 'hmac-sha256-hex' || !s.secret || !s.header) return false;
      const given = Object.entries(headers).find(([k]) => k.toLowerCase() === s.header.toLowerCase())?.[1]?.trim();
      if (!given || !/^[0-9a-f]+$/i.test(given)) return false;
      const expected = createHmac('sha256', s.secret).update(rawBody, 'utf8').digest();
      const got = Buffer.from(given, 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    },

    /** VERIFY: payload shape. Keeps ids, status and time only. */
    parse(rawBody: string): ParsedDeliveryEvent | null {
      let j: unknown;
      try {
        j = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const top = asObject(j);
      const d = asObject(top?.delivery) ?? asObject(top?.data) ?? top;
      if (!d) return null;
      const providerReference = asString(d.id) ?? asString(d.delivery_id);
      const merchantReference = asString(d.order_reference);
      if (!providerReference && !merchantReference) return null;
      const status = asString(d.status);
      const stateAt = asIsoTime(d.updated_at) ?? asIsoTime(top?.timestamp);
      return {
        eventId: asString(top?.event_id),
        merchantReference,
        providerReference,
        state: mapWumdropStatus(status),
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
 * The parser for this deployment, for the webhook parser registry. No signing
 * scheme is verified, so it refuses every request (polling is the fallback).
 */
export function wumdropWebhookParser(env: Env = process.env): DeliveryWebhookParser {
  void env;
  return createWumdropWebhookParser({ scheme: null });
}
