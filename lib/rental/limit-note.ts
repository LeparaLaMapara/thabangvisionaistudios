import { RENTAL_POLICY } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';

const rand = (cents: number): string => formatRand(Math.round(cents / 100));

/**
 * What a new account needs before it can rent an item worth this much, said
 * next to the Book button before anyone picks dates (clarity audit C5).
 *
 * The same rules the checkout enforces: the renter trust tiers in
 * RENTAL_POLICY.trustTierLimitsCents, applied by lib/core/rental/trust.ts to
 * the item's replacement value (lib/rental/protection itemValue). Null when a
 * new account can rent it straight away.
 */
export function gearLimitNote(valueCents: number): string | null {
  const limits = RENTAL_POLICY.trustTierLimitsCents;
  const proven = RENTAL_POLICY.trustThresholds.proven;
  const trusted = RENTAL_POLICY.trustThresholds.trusted;
  if (!(valueCents > limits.contactable)) return null;
  const start = `New accounts can rent up to ${rand(limits.contactable)} of gear at a time at first. This item is valued at ${rand(valueCents)}.`;
  if (valueCents <= limits.verified) {
    return `${start} To rent it, add a bank account in your own name: that raises your limit to ${rand(limits.verified)}.`;
  }
  if (valueCents <= limits.proven) {
    return `${start} Your limit rises to ${rand(limits.verified)} with a bank account in your own name, then to ${rand(limits.proven)} ${proven.historyDays} days after ${proven.cleanReturns === 1 ? 'your first on-time return' : `${proven.cleanReturns} on-time returns`}.`;
  }
  if (valueCents <= limits.trusted) {
    return `${start} Your limit rises with a bank account in your own name and on-time returns, up to ${rand(limits.trusted)} once you have made ${trusted.cleanReturns} on-time returns. WhatsApp us if you need it sooner.`;
  }
  return `${start} That is more than our largest limit, so WhatsApp us and we will arrange it.`;
}
