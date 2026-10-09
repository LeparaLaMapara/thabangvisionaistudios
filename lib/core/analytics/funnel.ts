/**
 * Customer funnel stages (spec §9.6), as pure definitions. The events are
 * written to platform_events with category 'funnel' and carry ids and codes
 * only: never names, emails, phone numbers, addresses, bank or payment details,
 * IP addresses or free text. sanitiseFunnelMeta enforces that.
 */

export const RENTER_FUNNEL = [
  { stage: 'rental_viewed', label: 'Viewed a listing' },
  { stage: 'dates_chosen', label: 'Chose dates' },
  { stage: 'rental_reserved', label: 'Reserved' },
  { stage: 'payment_started', label: 'Went to payment' },
  { stage: 'payment_confirmed', label: 'Payment confirmed' },
  { stage: 'rental_collected', label: 'Collected' },
  { stage: 'rental_returned', label: 'Returned' },
  { stage: 'rental_settled', label: 'Settled' },
] as const;

export const OWNER_FUNNEL = [
  { stage: 'listing_started', label: 'Started a listing' },
  { stage: 'listing_draft_complete', label: 'Draft complete' },
  { stage: 'listing_submitted', label: 'Submitted (verification and review)' },
  { stage: 'listing_published', label: 'Published' },
  { stage: 'listing_first_booking', label: 'First booking' },
  { stage: 'owner_first_payout', label: 'First payout' },
] as const;

export type RenterStage = (typeof RENTER_FUNNEL)[number]['stage'];
export type OwnerStage = (typeof OWNER_FUNNEL)[number]['stage'];
export type FunnelStage = RenterStage | OwnerStage;

export const FUNNEL_STAGES: readonly FunnelStage[] = [...RENTER_FUNNEL, ...OWNER_FUNNEL].map((s) => s.stage);

/** Stages a browser may report itself (everything else is recorded by the server where it happens). */
export const CLIENT_FUNNEL_STAGES: readonly FunnelStage[] = ['rental_viewed', 'dates_chosen'];

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_STAGES as readonly string[]).includes(v);
}

/** The event_type stored for a stage. */
export const funnelEventType = (stage: FunnelStage): string => `funnel_${stage}`;

/**
 * The only metadata keys a funnel event may carry. Ids are opaque
 * identifiers; codes are short machine codes; counts are numbers.
 */
const ALLOWED_KEYS = [
  'rentalId', 'bookingId', 'groupId', 'listingId', 'category',
  'source', 'code', 'codes', 'days', 'items', 'reviewed', 'surface',
] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];
export type FunnelMeta = Partial<Record<AllowedKey, string | number | boolean | string[] | null | undefined>>;

const ID_OR_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
// A value that IS contact or identity data (an email, a phone number, an ID
// or account number: all digits) is dropped even under an allowed key.
// Opaque ids (UUIDs, references with letters) pass.
const LOOKS_PERSONAL = /@|^\+?[\d\s-]{7,}$/;

function cleanScalar(v: unknown): string | number | boolean | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  if (!ID_OR_CODE.test(v) || LOOKS_PERSONAL.test(v)) return null;
  return v;
}

/** Keep only allowed keys with id/code/number values; everything else is dropped. */
export function sanitiseFunnelMeta(meta: Record<string, unknown> | null | undefined): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  if (!meta) return out;
  for (const key of ALLOWED_KEYS) {
    const v = meta[key];
    if (Array.isArray(v)) {
      const list = v.slice(0, 12).map(cleanScalar).filter((x): x is string => typeof x === 'string');
      if (list.length) out[key] = list;
      continue;
    }
    const c = cleanScalar(v);
    if (c !== null) out[key] = c;
  }
  return out;
}

/**
 * Counts per stage → conversion between consecutive stages. `counts` holds
 * the number of distinct subjects (people or listings) that reached a stage.
 */
export function funnelReport(
  stages: readonly { stage: FunnelStage; label: string }[],
  counts: Partial<Record<FunnelStage, number>>,
): { stage: FunnelStage; label: string; count: number; fromPrevious: number | null }[] {
  return stages.map((s, i) => {
    const count = counts[s.stage] ?? 0;
    const prev = i === 0 ? null : counts[stages[i - 1].stage] ?? 0;
    return { stage: s.stage, label: s.label, count, fromPrevious: prev === null ? null : prev > 0 ? Math.round((count / prev) * 1000) / 10 : null };
  });
}
