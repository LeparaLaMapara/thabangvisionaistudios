import type { RequestStatus } from './reveal';

/**
 * Guards on People requests (migration 096). Pure.
 *
 *   One open request per client, person and first day: a double submit (two
 *   taps, two tabs, a network retry) returns the request already sent
 *   instead of making a second one. A declined or withdrawn request can be
 *   asked again.
 *   No double booking: staff cannot accept a request while the same person
 *   (any of their roles) is already accepted or confirmed on one of its days.
 */

/** Statuses that hold the client's ask open (the 096 unique index uses the same list). */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['requested', 'accepted', 'confirmed'];
/** Statuses that hold the person's day. */
export const BOOKED_REQUEST_STATUSES: readonly RequestStatus[] = ['accepted', 'confirmed'];

export interface DatedRequest {
  id: string;
  requested_date: string;
  requested_dates: string[] | null;
}

/** Every day a request asks for. */
export function requestDays(r: Pick<DatedRequest, 'requested_date' | 'requested_dates'>): string[] {
  return Array.isArray(r.requested_dates) && r.requested_dates.length ? r.requested_dates : [r.requested_date];
}

/** The first already-booked request that shares a day with this one, and the shared days. */
export function overlappingRequest(target: DatedRequest, booked: readonly DatedRequest[]): { id: string; days: string[] } | null {
  const mine = new Set(requestDays(target));
  for (const other of booked) {
    if (other.id === target.id) continue;
    const days = requestDays(other).filter((d) => mine.has(d));
    if (days.length) return { id: other.id, days: days.sort() };
  }
  return null;
}

/** Postgres unique_violation: the 096 index refused a second open request. */
export function isDuplicateRequestError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
}
