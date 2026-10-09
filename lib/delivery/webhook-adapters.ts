/**
 * Courier adapters that receive webhooks register their parser by being
 * imported here (one side-effect import each). The module imported calls
 * `registerDeliveryWebhookParser` from lib/delivery/webhooks.ts.
 *
 *   import '@/lib/delivery/<provider>/webhook';
 *
 * Our own fleet (the manual adapter) has no webhooks: staff move its legs in
 * the admin console. Until a courier adapter is added, every provider id is
 * unknown and the route answers 404 without storing anything.
 */
export {};
