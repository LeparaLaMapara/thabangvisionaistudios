import { STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';

// The page is a client component, so its metadata lives here.
export const metadata = buildPageMetadata({
  title: 'On-Set Calculators for Photo and Film',
  description: `Free calculators for shoots: depth of field, storage for a day of filming, power draw and more, from ${STUDIO.shortName}.`,
  path: '/resources/tools',
});

export default function ResourcesToolsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
