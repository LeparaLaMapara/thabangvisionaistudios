/**
 * Browser side of the funnel (spec §9.6): report that a listing was viewed or
 * dates were chosen. Ids and a day count only. Never blocks or throws.
 */
export function reportFunnel(stage: 'rental_viewed' | 'dates_chosen', p: { rentalId: string; days?: number; surface?: string }): void {
  try {
    void fetch('/api/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, rentalId: p.rentalId, days: p.days, surface: p.surface }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics never breaks the page */
  }
}
