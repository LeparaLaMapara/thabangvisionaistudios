import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyYocoSignature, isYocoReference } from '@/lib/payments/yoco';
import { isPaymentUrl } from '@/lib/payments/hosts';

const secretBytes = Buffer.from('a-test-secret-for-yoco-webhooks');
const secret = `whsec_${secretBytes.toString('base64')}`;
const NOW = 1_790_000_000;

function sign(id: string, ts: string, body: string): string {
  return crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64');
}

describe('Yoco webhook signature', () => {
  const body = JSON.stringify({ type: 'payment.succeeded', payload: { amount: 50000 } });
  const ts = String(NOW);

  it('accepts a correctly signed event', () => {
    expect(verifyYocoSignature({ id: 'msg_1', timestamp: ts, body, signatureHeader: `v1,${sign('msg_1', ts, body)}`, secret, nowSeconds: NOW })).toBe(true);
  });
  it('accepts when one of several signatures matches', () => {
    expect(verifyYocoSignature({ id: 'msg_1', timestamp: ts, body, signatureHeader: `v1,bogus v1,${sign('msg_1', ts, body)}`, secret, nowSeconds: NOW })).toBe(true);
  });
  it('rejects a changed body', () => {
    expect(verifyYocoSignature({ id: 'msg_1', timestamp: ts, body: body.replace('50000', '5'), signatureHeader: `v1,${sign('msg_1', ts, body)}`, secret, nowSeconds: NOW })).toBe(false);
  });
  it('rejects an old event (replay)', () => {
    expect(verifyYocoSignature({ id: 'msg_1', timestamp: ts, body, signatureHeader: `v1,${sign('msg_1', ts, body)}`, secret, nowSeconds: NOW + 600 })).toBe(false);
  });
  it('rejects when no secret is configured', () => {
    expect(verifyYocoSignature({ id: 'msg_1', timestamp: ts, body, signatureHeader: `v1,${sign('msg_1', ts, body)}`, secret: '', nowSeconds: NOW })).toBe(false);
  });
});

describe('which provider a stored reference belongs to', () => {
  it('Yoco checkout ids start with ch_; everything else is Paystack', () => {
    expect(isYocoReference('ch_abc123')).toBe(true);
    expect(isYocoReference('4099260516')).toBe(false);
    expect(isYocoReference('BK-x1y2z3')).toBe(false);
    expect(isYocoReference(null)).toBe(false);
  });
});

describe('payment links the browser may follow', () => {
  it('allows the providers over https only', () => {
    expect(isPaymentUrl('https://checkout.paystack.com/abc')).toBe(true);
    expect(isPaymentUrl('https://c.yoco.com/checkout/ch_1')).toBe(true);
    expect(isPaymentUrl('http://checkout.paystack.com/abc')).toBe(false);
    expect(isPaymentUrl('https://evil.example/checkout')).toBe(false);
    expect(isPaymentUrl('not a url')).toBe(false);
  });
});
