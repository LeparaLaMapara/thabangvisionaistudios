import { buildPageMetadata } from '@/lib/seo/metadata';

// Reached from an email link; never a search result.
export const metadata = buildPageMetadata({
  title: 'Unsubscribe',
  description: 'Stop receiving these emails.',
  path: '/unsubscribe',
  noIndex: true,
});

export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
