/**
 * Calendar dates as the person sees them, not as UTC.
 *
 * The booking widget used Date.toISOString().split('T')[0], which is the UTC
 * date. In Johannesburg (UTC+2) local midnight on 3 October is 22:00 on
 * 2 October UTC, so the day sent to the server was the day before the one
 * picked. These keep the local calendar date.
 */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-10-03" to local midnight on that day; anything else to null. */
export function fromLocalYmd(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
