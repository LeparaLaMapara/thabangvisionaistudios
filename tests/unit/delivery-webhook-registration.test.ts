import { describe, it, expect } from 'vitest';
import '@/lib/delivery/webhook-adapters';
import { resolveDeliveryWebhookParser, registeredDeliveryWebhookProviders, hmacSha256 } from '@/lib/delivery/webhooks';

describe('courier webhook parsers are registered, and closed until switched on', () => {
  it('both couriers are known to the route', () => {
    expect(registeredDeliveryWebhookProviders()).toEqual(expect.arrayContaining(['uber_direct', 'wumdrop']));
  });

  it('Uber Direct: no parser unless enabled and a signing key for its mode is set', () => {
    const closed = { kind: 'not_configured' };
    expect(resolveDeliveryWebhookParser('uber_direct', {})).toEqual(closed);
    expect(resolveDeliveryWebhookParser('uber_direct', { DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: 'true' })).toEqual(closed);
    expect(resolveDeliveryWebhookParser('uber_direct', { UBER_DIRECT_WEBHOOK_SIGNING_KEY: 'k' })).toEqual(closed);
    const env = { DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: 'true', DELIVERY_PROVIDER_UBER_DIRECT_MODE: 'sandbox', UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY: 'secret' };
    const found = resolveDeliveryWebhookParser('uber_direct', env);
    expect(found.kind).toBe('ok');
    const parser = found.kind === 'ok' ? found.parser : null;
    expect(parser?.providerId).toBe('uber_direct');
    const body = '{"kind":"event.delivery_status"}';
    expect(parser?.verify(body, { 'x-uber-signature': hmacSha256('secret', body, 'hex') })).toBe(true);
    expect(parser?.verify(body, { 'x-uber-signature': hmacSha256('wrong', body, 'hex') })).toBe(false);
  });

  it('WumDrop: never accepts webhooks (signing not verified; polling instead)', () => {
    expect(resolveDeliveryWebhookParser('wumdrop', { DELIVERY_PROVIDER_WUMDROP_ENABLED: 'true' })).toEqual({ kind: 'not_configured' });
  });
});
