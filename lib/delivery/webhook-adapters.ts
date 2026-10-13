/**
 * Courier adapters that receive webhooks, registered with the parser registry
 * (lib/delivery/webhooks.ts). The route /api/webhooks/delivery/<id> answers:
 *   404 for an unknown id, 503 when the provider is not switched on or has no
 *   verified signing secret (nothing is stored), 401 for a bad signature.
 *
 * Our own fleet (the manual adapter) has no webhooks: staff move its legs in
 * the admin console.
 */

import { registerDeliveryWebhookParser } from './webhooks';
import { uberDirectWebhookParser } from './uber-direct';
import { wumdropWebhookParser } from './wumdrop';
import { bobgoWebhookParser } from './bobgo';

type Env = Record<string, string | undefined>;

const enabled = (env: Env, id: string): boolean =>
  (env[`DELIVERY_PROVIDER_${id.toUpperCase()}_ENABLED`] ?? '').toLowerCase() === 'true';

// Uber Direct: HMAC-SHA256 over the raw body. Only when the provider is
// switched on and the signing key for its mode is set.
registerDeliveryWebhookParser('uber_direct', (env: Env) => {
  if (!enabled(env, 'uber_direct')) return null;
  const sandbox = (env.DELIVERY_PROVIDER_UBER_DIRECT_MODE ?? '').toLowerCase() === 'sandbox';
  const key = sandbox ? env.UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY : env.UBER_DIRECT_WEBHOOK_SIGNING_KEY;
  return key?.trim() ? uberDirectWebhookParser(env) : null;
});

// WumDrop: webhook signing is not verified (docs/logistics/wumdrop.md), so its
// webhooks are never accepted; jobs are followed by the daily poll instead.
registerDeliveryWebhookParser('wumdrop', (env: Env) => {
  void wumdropWebhookParser;
  void env;
  return null;
});

// Bob Go: the signing scheme is unknown (lib/delivery/bobgo/api-contract.ts),
// so its webhooks are never accepted (503, nothing stored), whatever is set;
// orders are followed by reading them instead.
registerDeliveryWebhookParser('bobgo', (env: Env) => bobgoWebhookParser(env));
