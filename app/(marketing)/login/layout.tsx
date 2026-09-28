import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const metadata = buildPageMetadata({
  title: 'Sign In',
  description: `Sign in to ${STUDIO.shortName} to book gear or send a shoot request.`,
  path: '/login',
  noIndex: true,
});

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
