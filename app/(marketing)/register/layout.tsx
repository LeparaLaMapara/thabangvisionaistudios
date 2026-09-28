import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const metadata = buildPageMetadata({
  title: 'Create an Account',
  description: `Create a free ${STUDIO.shortName} account to book gear. We check your ID once, before your first hire.`,
  path: '/register',
});

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
