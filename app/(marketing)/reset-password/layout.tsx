import { buildPageMetadata } from '@/lib/seo/metadata';
export const dynamic = 'force-dynamic';

export const metadata = buildPageMetadata({
  title: 'Reset Password',
  description: 'Choose a new password for your account.',
  path: '/reset-password',
  noIndex: true,
});

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
