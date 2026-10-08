import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Paystack's API host is api.paystack.co. The .com host is wrong and used to
// be hardcoded in two places (lib/payments/paystack.ts, app/api/banking).
const WRONG_HOST = ['api', 'paystack', 'com'].join('.');
const ROOT = path.resolve(__dirname, '../..');
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Paystack API host', () => {
  it(`no source file in lib/ or app/ uses ${WRONG_HOST}`, () => {
    const files = [...sourceFiles(path.join(ROOT, 'lib')), ...sourceFiles(path.join(ROOT, 'app'))];
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes(WRONG_HOST))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the provider talks to api.paystack.co', async () => {
    const { PAYSTACK_API } = await import('@/lib/payments/paystack');
    expect(PAYSTACK_API).toBe('https://api.paystack.co');
  });

  it('hosted checkout stays on checkout.paystack.com', async () => {
    const { paystack } = await import('@/lib/payments/paystack');
    expect(paystack.allowedHosts).toContain('checkout.paystack.com');
  });
});
