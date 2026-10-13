/**
 * One set of words for a gear booking's status, used by the bookings list,
 * the booking page and Ubunye, so a renter never sees "return_pending" in one
 * place and "returned, being checked" in another.
 */
export const GEAR_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'waiting for payment',
  confirmed: 'confirmed',
  active: 'on hire',
  overdue: 'overdue',
  return_pending: 'returned, being checked',
  return_reviewed: 'inspected, deposit being settled',
  completed: 'completed',
  disputed: 'being reviewed',
  cancelled: 'cancelled',
};

export function gearStatusLabel(status: string): string {
  return GEAR_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}
