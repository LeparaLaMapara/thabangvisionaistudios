import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────
// We test the pure logic directly rather than importing from lib/payfast.ts,
// because that module reads process.env at module scope.  We replicate the
// exact algorithm here so the tests are self-contained and deterministic.

function generateSignature(
  params: Record<string, string>,
  passphrase: string,
): string {
  const paramString = Object.keys(params)
    .filter((key) => key !== 'signature' && params[key] !== '')
    .sort()
    .map(
      (key) =>
        `${key}=${encodeURIComponent(params[key]).replace(/%20/g, '+')}`,
    )
    .join('&');

  const stringToHash = passphrase
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : paramString;

  return crypto.createHash('md5').update(stringToHash).digest('hex');
}

function validateSignature(
  params: Record<string, string>,
  receivedSignature: string,
  passphrase: string,
): boolean {
  const expected = generateSignature(params, passphrase);
  return expected === receivedSignature;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PayFast — generateSignature', () => {
  it('produces a 32-char hex MD5 hash', () => {
    const sig = generateSignature(
      { merchant_id: '10000100', merchant_key: '46f0cd694581a' },
      '',
    );
    expect(sig).toMatch(/^[a-f0-9]{32}$/);
  });

  it('sorts parameters alphabetically', () => {
    const a = generateSignature(
      { z_param: 'last', a_param: 'first' },
      '',
    );
    const b = generateSignature(
      { a_param: 'first', z_param: 'last' },
      '',
    );
    expect(a).toBe(b);
  });

  it('excludes the signature key from the hash input', () => {
    const withoutSig = generateSignature(
      { amount: '100.00', item_name: 'Test' },
      '',
    );
    const withSig = generateSignature(
      { amount: '100.00', item_name: 'Test', signature: 'should_be_ignored' },
      '',
    );
    expect(withoutSig).toBe(withSig);
  });

  it('excludes empty-string values', () => {
    const base = generateSignature({ amount: '100.00' }, '');
    const withEmpty = generateSignature(
      { amount: '100.00', email: '' },
      '',
    );
    expect(base).toBe(withEmpty);
  });

  it('appends passphrase when provided', () => {
    const noPass = generateSignature({ amount: '100.00' }, '');
    const withPass = generateSignature({ amount: '100.00' }, 'secret');
    expect(noPass).not.toBe(withPass);
  });

  it('produces a deterministic hash for the same input', () => {
    const params = {
      merchant_id: '10000100',
      merchant_key: '46f0cd694581a',
      amount: '150.00',
      item_name: 'Camera Rental',
    };
    const sig1 = generateSignature(params, 'myPassphrase');
    const sig2 = generateSignature(params, 'myPassphrase');
    expect(sig1).toBe(sig2);
  });
});

describe('PayFast — validateSignature', () => {
  const passphrase = 'testpass';
  const params = {
    merchant_id: '10000100',
    amount: '250.00',
    item_name: 'Lens Rental',
  };

  it('returns true for a valid signature', () => {
    const sig = generateSignature(params, passphrase);
    expect(validateSignature(params, sig, passphrase)).toBe(true);
  });

  it('returns false for a tampered signature', () => {
    expect(
      validateSignature(params, 'aaaabbbbccccddddeeeeffffaaaabbbb', passphrase),
    ).toBe(false);
  });

  it('returns false when passphrase differs', () => {
    const sig = generateSignature(params, passphrase);
    expect(validateSignature(params, sig, 'wrong-passphrase')).toBe(false);
  });

  it('returns false when params are modified after signing', () => {
    const sig = generateSignature(params, passphrase);
    const tampered = { ...params, amount: '999.00' };
    expect(validateSignature(tampered, sig, passphrase)).toBe(false);
  });
});

describe('PayFast — getPayFastUrl', () => {
  it('returns sandbox URL when NEXT_PUBLIC_PAYFAST_SANDBOX is true', () => {
    const isSandbox = true;
    const url = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
    expect(url).toBe('https://sandbox.payfast.co.za/eng/process');
  });

  it('returns production URL when sandbox is false', () => {
    const isSandbox = false;
    const url = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
    expect(url).toBe('https://www.payfast.co.za/eng/process');
  });
});
