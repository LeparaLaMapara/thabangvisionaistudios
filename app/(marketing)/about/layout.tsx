import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: `About ${STUDIO.shortName}`,
  description: `Book what a shoot needs on ${STUDIO.shortName}: camera, lighting and sound gear in ${STUDIO.location.city}, and photo and video shoots. Plus free creative apps from our research lab.`,
  path: '/about',
});

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
