import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STUDIO } from '@/lib/constants';

/**
 * Internal alerts go to the inbox that owns them (Cloudflare Email Routing
 * forwards each address to its own Gmail label): system and agent alerts to
 * security@, money alerts to billing@, booking work stays on bookings@.
 */
const src = (path: string): string => readFileSync(path, 'utf8');

describe('alert mail routing', () => {
  it('has the security and billing addresses on the domain', () => {
    expect(STUDIO.securityEmail).toBe('security@thabangvision.com');
    expect(STUDIO.billingEmail).toBe('billing@thabangvision.com');
  });

  it('sends system and agent alerts to security@', () => {
    for (const path of ['app/api/cron/invariants/route.ts', 'app/api/cron/hourly-checks/route.ts', 'app/api/cron/ai-budget-checks/route.ts']) {
      expect(src(path), path).toContain('to: STUDIO.securityEmail');
    }
  });

  it('sends payout and payment alerts to billing@', () => {
    const daily = src('app/api/cron/daily-maintenance/route.ts');
    for (const subject of ['[Released] ${releasedOrders.length}', '[Released] ${orders.length}', '[Payouts]', '[Alert] ${stuck.length} payout']) {
      const at = daily.indexOf(subject);
      expect(at, subject).toBeGreaterThan(-1);
      expect(daily.slice(Math.max(0, at - 120), at), subject).toContain('to: STUDIO.billingEmail');
    }
    expect(src('lib/payments/service-transfers.ts')).toContain('to: STUDIO.billingEmail');
  });
});
