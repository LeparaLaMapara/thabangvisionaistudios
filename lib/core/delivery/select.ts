/**
 * Provider selection (spec Phase 4 §4.6). Pure.
 *
 * Priorities, in order:
 *   1. legal and contractual eligibility (enabled, not sandbox, value threshold)
 *   2. verified transit cover          ┐ providerRiskGate (policy.ts):
 *   3. chain-of-custody capabilities   ┘ a failure EXCLUDES, whatever the price
 *   4. service-area coverage            (the provider's serviceability answer)
 *   5. availability for the window      (serviceability + a quote for it)
 *   6. reliability  ┐
 *   7. speed        ├ ordering only, as configured in
 *   8. price        ┘ DELIVERY_POLICY.providerPreferences (never hardcoded)
 *
 * A provider that is down (unknown/rejected call) is excluded with a reason;
 * the others are still offered (D20). No eligible provider means collection
 * in person, and the booking itself stays possible.
 */

import { DELIVERY_POLICY } from '@/lib/constants';
import type { ProviderCallResult } from '@/lib/core/ports';
import type { ProviderQuote, ServiceabilityResult } from './port';
import type { ProviderGateSubject } from './policy';

export type RankCriterion = 'reliability' | 'speed' | 'price';

export interface ProviderPreferences {
  rankBy: readonly RankCriterion[];
  /** 0–100 per provider id; unknown = 0. */
  reliability: Readonly<Record<string, number>>;
}

export const DEFAULT_PROVIDER_PREFERENCES: ProviderPreferences = DELIVERY_POLICY.providerPreferences;

export interface EvaluatedCandidate {
  provider: ProviderGateSubject;
  /** providerRiskGate result (priorities 1–3). */
  gate: { eligible: boolean; reasons: string[] };
  /** Not asked when the gate already excluded the provider. */
  serviceability: ProviderCallResult<ServiceabilityResult> | null;
  quote: ProviderCallResult<ProviderQuote> | null;
}

export interface RankedOption {
  providerId: string;
  kind: 'courier' | 'own_fleet';
  quote: ProviderQuote;
  reliability: number;
}

export interface SelectionResult {
  options: RankedOption[];
  excluded: { providerId: string; reasons: string[] }[];
  /** True when nothing can deliver: offer collection in person. */
  collectionOnly: boolean;
}

function callReason(r: { ok: false; kind: 'rejected' | 'unknown' }, what: string): string {
  return r.kind === 'unknown' ? `${what}_unavailable` : `${what}_refused`;
}

export function selectDeliveryProviders(candidates: readonly EvaluatedCandidate[], prefs: ProviderPreferences = DEFAULT_PROVIDER_PREFERENCES): SelectionResult {
  const options: (RankedOption & { order: number })[] = [];
  const excluded: SelectionResult['excluded'] = [];

  candidates.forEach((c, order) => {
    const id = c.provider.providerId;
    if (!c.gate.eligible) {
      excluded.push({ providerId: id, reasons: c.gate.reasons.length ? c.gate.reasons : ['not_eligible'] });
      return;
    }
    const s = c.serviceability;
    if (!s) return void excluded.push({ providerId: id, reasons: ['serviceability_not_checked'] });
    if (!s.ok) return void excluded.push({ providerId: id, reasons: [callReason(s, 'serviceability')] });
    if (!s.value.serviceable) return void excluded.push({ providerId: id, reasons: [s.value.reason ?? 'not_serviceable'] });
    const q = c.quote;
    if (!q) return void excluded.push({ providerId: id, reasons: ['quote_not_requested'] });
    if (!q.ok) return void excluded.push({ providerId: id, reasons: [callReason(q, 'quote')] });
    if (!Number.isSafeInteger(q.value.providerCostCents) || q.value.providerCostCents < 0) {
      return void excluded.push({ providerId: id, reasons: ['quote_invalid_amount'] });
    }
    options.push({ providerId: id, kind: c.provider.kind ?? 'courier', quote: q.value, reliability: prefs.reliability[id] ?? 0, order });
  });

  const startMs = (o: RankedOption): number => (o.quote.window.start ? new Date(o.quote.window.start).getTime() : 0);
  const cmp: Record<RankCriterion, (a: RankedOption, b: RankedOption) => number> = {
    reliability: (a, b) => b.reliability - a.reliability,
    speed: (a, b) => startMs(a) - startMs(b),
    price: (a, b) => a.quote.providerCostCents - b.quote.providerCostCents,
  };
  options.sort((a, b) => {
    for (const k of prefs.rankBy) {
      const d = cmp[k](a, b);
      if (d !== 0) return d;
    }
    return a.order - b.order;
  });

  return {
    options: options.map((o) => ({ providerId: o.providerId, kind: o.kind, quote: o.quote, reliability: o.reliability })),
    excluded,
    collectionOnly: options.length === 0,
  };
}
