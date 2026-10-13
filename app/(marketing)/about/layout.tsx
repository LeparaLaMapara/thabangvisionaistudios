import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: `About ${STUDIO.shortName}`,
  description: `${STUDIO.shortName} rents camera, lighting and sound gear in ${STUDIO.location.city}, and takes photo and video shoots by request.`,
  path: '/about',
});

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
