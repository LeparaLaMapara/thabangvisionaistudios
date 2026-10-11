// Shared class strings for the Ubunye Creative Studio pages (/tools).
// Colours come from CSS variables set in app/(platform)/tools/layout.tsx.

/** DM Serif Display, the suite's display face. */
export const UB_DISPLAY = 'font-[family-name:var(--font-ubunye-display)] font-normal';

/** Uppercase Inter label with the brand's wide tracking (0.32em). */
export const UB_LABEL = 'font-sans uppercase tracking-[0.32em] text-[11px] sm:text-xs';

/** Hex colour plus alpha (00-ff) as an 8-digit hex string. */
export function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}
