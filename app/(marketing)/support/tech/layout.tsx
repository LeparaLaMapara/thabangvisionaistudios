import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';
export const revalidate = 60;

// A support ticket form: reachable from the site, not a search landing page.
export const metadata = buildPageMetadata({
  title: 'Tech Support',
  description: `Report a problem with the ${STUDIO.shortName} website or your account.`,
  path: '/support/tech',
  noIndex: true,
});

export default function TechSupportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
