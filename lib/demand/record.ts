import { createAdminClient } from '@/lib/supabase/server';

/**
 * Recording the demand the platform could not serve.
 *
 * The platform knows exactly what it sold and nothing about what it could not.
 * That second half is the more useful one: it is the list of gear to buy, dates
 * that are worth more, and eventually things worth building. A marketplace
 * forgets these moments; an engine keeps them.
 *
 * Two rules, both load-bearing.
 *
 * ONE: this must never fail the thing it is watching. A checkout that dies
 * because a research write failed would be a straight downgrade. Every write
 * here swallows its own errors and returns void. There is no caller that should
 * branch on whether the record landed.
 *
 * TWO: queries are normalised before they are stored, so "Sony A7", "sony  a7"
 * and "SONY A7 " aggregate into one row instead of three. Ungrouped free text
 * is not a signal, it is a pile.
 */

export type UnmetDemandKind =
  | 'search_no_results'
  | 'unavailable_dates'
  | 'not_in_catalogue';

export type UnmetDemandSource = 'search' | 'checkout' | 'ubunye';

/** Longest query worth storing. Beyond this it is a paste, not a search. */
const MAX_QUERY_LENGTH = 120;

/**
 * Trim, lowercase, collapse internal whitespace.
 *
 * Returns null for anything not worth a row: empty, whitespace only, a single
 * character, or long enough that it is not really a query.
 */
export function normaliseQuery(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleaned.length < 2) return null;
  if (cleaned.length > MAX_QUERY_LENGTH) return null;
  return cleaned;
}

export interface UnmetDemandRecord {
  kind: UnmetDemandKind;
  query: string;
  source: UnmetDemandSource;
  rentalId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  requested?: number | null;
  available?: number | null;
  userId?: string | null;
}

/**
 * Write one unmet-demand row. Never throws, never rejects.
 *
 * Not awaited by most callers on purpose: this is research, and research does
 * not get to add latency to a checkout.
 */
export async function recordUnmetDemand(record: UnmetDemandRecord): Promise<void> {
  const query = normaliseQuery(record.query);
  if (!query) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('unmet_demand').insert({
      kind: record.kind,
      query,
      source: record.source,
      rental_id: record.rentalId ?? null,
      start_date: record.startDate ?? null,
      end_date: record.endDate ?? null,
      requested: record.requested ?? null,
      available: record.available ?? null,
      user_id: record.userId ?? null,
    });

    if (error) {
      // Table missing is expected until 057 is applied; do not shout about it.
      if (!error.message.includes('does not exist')) {
        console.error('[recordUnmetDemand]', error.message);
      }
    }
  } catch (err) {
    console.error('[recordUnmetDemand] threw:', err);
  }
}

/**
 * Fire-and-forget wrapper for hot paths.
 *
 * Deliberately not awaited by the caller, with the rejection handler attached
 * here so a floating promise can never become an unhandled rejection.
 */
export function recordUnmetDemandAsync(record: UnmetDemandRecord): void {
  void recordUnmetDemand(record).catch(() => {});
}
