import { RENTAL_POLICIES } from '@/lib/constants';
import { startOfBookedDay } from '@/lib/rental/cancellation';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The late fee for one booking line: R150 (RENTAL_POLICIES) per item for each
 * day or part of a day after the return day ends, for at most maxLateDays
 * days, and never more than that line's deposit. Pure, so it is tested.
 */
export function lateFeeFor(params: {
  endDate: string;
  returnedAt: Date;
  quantity?: number | null;
  deposit: number;
}): { daysLate: number; fee: number } {
  const lateFrom = startOfBookedDay(params.endDate).getTime() + DAY_MS;
  const ms = params.returnedAt.getTime() - lateFrom;
  if (ms <= 0) return { daysLate: 0, fee: 0 };
  const daysLate = Math.min(Math.ceil(ms / DAY_MS), RENTAL_POLICIES.maxLateDays);
  const items = Math.max(1, params.quantity ?? 1);
  const fee = Math.min(daysLate * RENTAL_POLICIES.lateFeePerDayZar * items, Math.max(0, params.deposit));
  return { daysLate, fee };
}

/** What comes back of the deposit after the late fee and any damage charge. */
export function depositSettlement(params: { deposit: number; lateFee: number; damageFee: number }): {
  release: number;
  kept: number;
} {
  const deposit = Math.max(0, params.deposit);
  const kept = Math.min(deposit, Math.max(0, params.lateFee) + Math.max(0, params.damageFee));
  return { release: Math.round((deposit - kept) * 100) / 100, kept: Math.round(kept * 100) / 100 };
}
