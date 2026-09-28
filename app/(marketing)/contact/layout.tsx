import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: 'Contact Us',
  description: `Ask about gear, a booking or a shoot. Call ${STUDIO.phone} or email ${STUDIO.email}.`,
  path: '/contact',
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
