import { buildPageMetadata } from '@/lib/seo/metadata';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: 'Where to Collect',
  description: 'Where to collect your gear in Braamfontein, Johannesburg, and our business hours.',
  path: '/locations',
});

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
