import { DM_Serif_Display } from 'next/font/google';
import type { CSSProperties } from 'react';
import { UBUNYE_STUDIO } from '@/lib/constants';

// The suite's display face. Loaded here, not in the root layout, so only the
// /tools pages ship it. Inter (labels) already comes from the root layout.
const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-ubunye-display',
  display: 'swap',
});

/**
 * Ubunye Creative Studio section. Sets the suite's own colour tokens as CSS
 * variables (values from UBUNYE_STUDIO.colors) so the pages never hardcode them.
 */
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  const { colors } = UBUNYE_STUDIO;
  const vars = {
    '--ub-bg': colors.bg,
    '--ub-bg-2': colors.bgSecondary,
    '--ub-text': colors.text,
    '--ub-text-2': colors.textSecondary,
  } as CSSProperties;

  return (
    <div
      className={`${dmSerif.variable} min-h-screen bg-[var(--ub-bg)] text-[var(--ub-text)]`}
      style={vars}
    >
      {children}
    </div>
  );
}
