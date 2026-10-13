import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

// /register redirects to /login (one screen for signing in and signing up).
export const metadata = buildPageMetadata({
  title: 'Create an Account',
  description: `Create a free ${STUDIO.shortName} account to book gear. We check your ID once, before your first hire.`,
  path: '/register',
  noIndex: true,
});

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
